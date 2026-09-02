import { once } from "node:events";
import type { NextApiRequest, NextApiResponse } from "next";

import { createNextApiContext } from "@kan/api/trpc";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { assertPermission } from "@kan/api/utils/permissions";
import { withRateLimit } from "@kan/api/utils/rateLimit";
import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";
import { isValidWorkDate } from "@kan/db/repository/timeTracking.utils";

import {
  encodeCsvRow,
  encodeTimeTrackingEntriesCsvRow,
  encodeTimeTrackingSummaryCsvRow,
  getTimeTrackingCsvMemberDisplayName,
  getTimeTrackingCsvMemberEmail,
  getTimeTrackingExportFilename,
  getTimeTrackingSourceTimestamp,
  TIME_TRACKING_DETAILED_CSV_HEADERS,
  TIME_TRACKING_ENTRIES_CSV_HEADERS,
  TIME_TRACKING_SUMMARY_CSV_HEADERS,
} from "~/server/timeTrackingCsv";

const EXPORT_PAGE_SIZE = 500;

const getQueryString = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const getQueryStrings = (value: string | string[] | undefined) => {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
};

const deduplicate = (values: string[] | undefined) =>
  values?.length ? [...new Set(values)] : undefined;

const isExportGroupBy = (
  value: string | undefined,
): value is timeTrackingRepo.TimeTrackingExportGroupBy =>
  value === "member" ||
  value === "card" ||
  value === "list" ||
  value === "date";

type WorklogGroup = Awaited<
  ReturnType<typeof timeTrackingRepo.getBoardWorklogGroups>
>[number];

const getGroupLabel = (group: WorklogGroup) => {
  if (!group.member) return group.label;
  return getTimeTrackingCsvMemberDisplayName(group.member);
};

const getWorklogMember = (
  member: Awaited<
    ReturnType<typeof timeTrackingRepo.listBoardWorklogs>
  >["items"][number]["workspaceMember"],
) =>
  member
    ? {
        publicId: member.publicId,
        email: member.email,
        displayName: member.user?.name ?? null,
        userEmail: member.user?.email ?? null,
        showEmailsToMembers: member.workspace.showEmailsToMembers,
      }
    : null;

const getLabels = (
  row: Awaited<
    ReturnType<typeof timeTrackingRepo.listBoardWorklogs>
  >["items"][number],
) =>
  (row.card?.labels ?? [])
    .filter(({ label }) => label.deletedAt === null)
    .map(({ label }) => label);

const writeChunk = async (res: NextApiResponse, chunk: string) => {
  if (!res.write(chunk)) await once(res, "drain");
};

export default withRateLimit(
  { points: 20, duration: 60 },
  withApiLogging(async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "GET")
      return res.status(405).json({ error: "Method not allowed" });

    try {
      const { user, db } = await createNextApiContext(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const boardPublicId = getQueryString(req.query.boardPublicId);
      const dateFrom = getQueryString(req.query.dateFrom);
      const dateTo = getQueryString(req.query.dateTo);
      const profile = getQueryString(req.query.profile);
      const groupBy = getQueryString(req.query.groupBy);
      if (
        !boardPublicId ||
        boardPublicId.length !== 12 ||
        !dateFrom ||
        !dateTo ||
        !isValidWorkDate(dateFrom) ||
        !isValidWorkDate(dateTo) ||
        dateFrom > dateTo ||
        (profile !== "summary" &&
          profile !== "entries" &&
          profile !== "detailed")
      )
        return res.status(400).json({ error: "Invalid export parameters" });
      if (
        (profile === "summary" && !isExportGroupBy(groupBy)) ||
        (profile !== "summary" && groupBy !== undefined)
      )
        return res.status(400).json({ error: "Invalid export grouping" });

      const rawPublicIdFilters = {
        memberPublicIds: getQueryStrings(req.query.memberPublicIds),
        cardPublicIds: getQueryStrings(req.query.cardPublicIds),
        listPublicIds: getQueryStrings(req.query.listPublicIds),
        labelPublicIds: getQueryStrings(req.query.labelPublicIds),
      };
      if (
        Object.values(rawPublicIdFilters).some(
          (publicIds) =>
            publicIds !== undefined &&
            (publicIds.length > 100 ||
              publicIds.some((publicId) => publicId.length !== 12)),
        )
      )
        return res.status(400).json({ error: "Invalid filter identifier" });

      const publicIdFilters = {
        memberPublicIds: deduplicate(rawPublicIdFilters.memberPublicIds),
        cardPublicIds: deduplicate(rawPublicIdFilters.cardPublicIds),
        listPublicIds: deduplicate(rawPublicIdFilters.listPublicIds),
        labelPublicIds: deduplicate(rawPublicIdFilters.labelPublicIds),
      };

      const board = await timeTrackingRepo.getBoardSettings(db, boardPublicId);
      if (!board) return res.status(404).json({ error: "Board not found" });
      const member = await timeTrackingRepo.getActiveWorkspaceMemberForUser(
        db,
        board.workspaceId,
        user.id,
      );
      if (!member) return res.status(403).json({ error: "Permission denied" });
      try {
        await assertPermission(db, user.id, board.workspaceId, "board:view");
        await assertPermission(db, user.id, board.workspaceId, "worklog:view");
      } catch {
        return res.status(403).json({ error: "Permission denied" });
      }

      const filters = { dateFrom, dateTo, ...publicIdFilters };
      const summaryGroups =
        profile === "summary" && isExportGroupBy(groupBy)
          ? await timeTrackingRepo.getBoardWorklogGroups(
              db,
              board.boardId,
              filters,
              groupBy,
            )
          : null;
      const profileName =
        profile === "summary" ? `${profile}-${groupBy}` : profile;
      const filename = getTimeTrackingExportFilename({
        boardName: board.boardName,
        boardPublicId: board.boardPublicId,
        dateFrom,
        dateTo,
        profileName,
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.flushHeaders();

      await writeChunk(res, "\uFEFF");

      if (profile === "summary") {
        if (!isExportGroupBy(groupBy) || !summaryGroups)
          throw new Error("Validated export grouping is missing");
        await writeChunk(res, encodeCsvRow(TIME_TRACKING_SUMMARY_CSV_HEADERS));
        for (const group of summaryGroups) {
          await writeChunk(
            res,
            encodeTimeTrackingSummaryCsvRow({
              groupBy,
              groupPublicId: group.publicId,
              groupLabel: getGroupLabel(group),
              durationSeconds: group.durationSeconds,
              entryCount: group.entryCount,
              boardName: board.boardName,
              boardPublicId: board.boardPublicId,
            }),
          );
        }
        res.end();
        return;
      }

      await writeChunk(
        res,
        encodeCsvRow(
          profile === "entries"
            ? TIME_TRACKING_ENTRIES_CSV_HEADERS
            : TIME_TRACKING_DETAILED_CSV_HEADERS,
        ),
      );

      let cursor: timeTrackingRepo.WorklogCursor | undefined;
      do {
        const page = await timeTrackingRepo.listBoardWorklogs(db, {
          boardId: board.boardId,
          filters,
          limit: EXPORT_PAGE_SIZE,
          cursor,
        });
        const sources =
          profile === "detailed"
            ? await timeTrackingRepo.listWorklogSourcesByWorklogIds(
                db,
                page.items.map((row) => row.id),
              )
            : [];
        const sourcesByWorklogId = new Map(
          sources.map((source) => [source.worklogId, source]),
        );
        for (const row of page.items) {
          const labels = getLabels(row);
          const member = getWorklogMember(row.workspaceMember);
          const memberName = member
            ? getTimeTrackingCsvMemberDisplayName(member)
            : "Unavailable member";
          const memberEmail = member
            ? getTimeTrackingCsvMemberEmail(member)
            : null;
          if (profile === "entries") {
            await writeChunk(
              res,
              encodeTimeTrackingEntriesCsvRow({
                workDate: row.workDate,
                durationSeconds: row.durationSeconds,
                memberName,
                memberEmail,
                boardName: board.boardName,
                cardName: row.card?.title ?? "Deleted card",
                cardNumber: row.card?.cardNumber ?? null,
                listName: row.card?.list.name ?? null,
                labels: labels.map((label) => label.name).join("; "),
                comment: row.comment,
              }),
            );
            continue;
          }
          const source = sourcesByWorklogId.get(row.id);
          await writeChunk(
            res,
            encodeCsvRow([
              row.publicId,
              row.workDate,
              row.durationSeconds,
              row.workspaceMember?.publicId,
              memberName,
              memberEmail,
              board.boardPublicId,
              board.boardName,
              row.card?.publicId,
              row.card?.title ?? "Deleted card",
              row.card?.cardNumber,
              row.card?.list.publicId,
              row.card?.list.name,
              labels.map((label) => label.publicId).join(";"),
              labels.map((label) => label.name).join("; "),
              row.entryMethod,
              row.timerStartedAt,
              row.timerStoppedAt,
              row.timerTimezone,
              row.rawElapsedSeconds,
              row.comment,
              row.createdAt,
              row.createdByUser?.name,
              row.updatedAt,
              row.updatedByUser?.name,
              source?.provider,
              source?.externalId,
              getTimeTrackingSourceTimestamp(
                source?.sourceCreatedAt,
                source?.sourceCreatedAtRaw,
              ),
              source?.sourceTimestampTimezone,
              source?.sourceCreatedByDisplayName,
              source?.sourceCreatedByExternalMemberId,
              getTimeTrackingSourceTimestamp(
                source?.sourceUpdatedAt,
                source?.sourceUpdatedAtRaw,
              ),
              source?.sourceUpdatedByDisplayName,
              source?.sourceUpdatedByExternalMemberId,
            ]),
          );
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      res.end();
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }),
);
