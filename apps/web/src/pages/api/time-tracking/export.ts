import { once } from "node:events";
import type { NextApiRequest, NextApiResponse } from "next";

import { createNextApiContext } from "@kan/api/trpc";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { assertPermission } from "@kan/api/utils/permissions";
import { withRateLimit } from "@kan/api/utils/rateLimit";
import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";
import { isValidWorkDate } from "@kan/db/repository/timeTracking.utils";

import { encodeCsvRow, formatCsvDuration } from "~/server/timeTrackingCsv";

const EXPORT_PAGE_SIZE = 500;

const getQueryString = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const getDisplayName = (member: {
  publicId: string;
  email: string;
  user: { name: string | null; email: string } | null;
  workspace: { showEmailsToMembers: boolean };
}) => {
  const name = member.user?.name?.trim();
  if (name) return name;
  if (member.workspace.showEmailsToMembers)
    return member.user?.email ?? member.email;
  return `anonymous_${member.publicId}`;
};

const getVisibleEmail = (member: {
  email: string;
  user: { email: string } | null;
  workspace: { showEmailsToMembers: boolean };
}) =>
  member.workspace.showEmailsToMembers
    ? (member.user?.email ?? member.email)
    : null;

const getLabels = (
  row: Awaited<
    ReturnType<typeof timeTrackingRepo.listBoardWorklogs>
  >["items"][number],
) =>
  row.card.labels
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
      const fromDate = getQueryString(req.query.fromDate);
      const toDate = getQueryString(req.query.toDate);
      const profile = getQueryString(req.query.profile);
      if (
        !boardPublicId ||
        boardPublicId.length < 12 ||
        !fromDate ||
        !toDate ||
        !isValidWorkDate(fromDate) ||
        !isValidWorkDate(toDate) ||
        fromDate > toDate ||
        (profile !== "summary" && profile !== "detailed")
      )
        return res.status(400).json({ error: "Invalid export parameters" });

      const optionalPublicIds = {
        workspaceMemberPublicId: getQueryString(
          req.query.workspaceMemberPublicId,
        ),
        cardPublicId: getQueryString(req.query.cardPublicId),
        listPublicId: getQueryString(req.query.listPublicId),
        labelPublicId: getQueryString(req.query.labelPublicId),
      };
      if (
        Object.values(optionalPublicIds).some(
          (publicId) => publicId !== undefined && publicId.length < 12,
        )
      )
        return res.status(400).json({ error: "Invalid filter identifier" });

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

      const filters = { fromDate, toDate, ...optionalPublicIds };
      const filename = `kan-time-${boardPublicId}-${fromDate}-${toDate}-${profile}.csv`;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.flushHeaders();

      await writeChunk(res, "\uFEFF");
      await writeChunk(
        res,
        profile === "summary"
          ? encodeCsvRow([
              "Date",
              "Duration",
              "Seconds",
              "Member",
              "Board",
              "Card",
              "List",
              "Labels",
              "Comment",
            ])
          : encodeCsvRow([
              "Worklog ID",
              "Date",
              "Duration seconds",
              "Member ID",
              "Member",
              "Member email",
              "Board ID",
              "Board",
              "Card ID",
              "Card",
              "Card number",
              "List ID",
              "List",
              "Label IDs",
              "Labels",
              "Entry method",
              "Timer started at",
              "Timer stopped at",
              "Timer timezone",
              "Raw elapsed seconds",
              "Comment",
              "Created at",
              "Created by user ID",
              "Created by",
              "Updated at",
              "Updated by user ID",
              "Updated by",
            ]),
      );

      let cursor: timeTrackingRepo.WorklogCursor | undefined;
      do {
        const page = await timeTrackingRepo.listBoardWorklogs(db, {
          boardId: board.boardId,
          filters,
          limit: EXPORT_PAGE_SIZE,
          cursor,
        });
        for (const row of page.items) {
          const labels = getLabels(row);
          const displayName = getDisplayName(row.workspaceMember);
          await writeChunk(
            res,
            profile === "summary"
              ? encodeCsvRow([
                  row.workDate,
                  formatCsvDuration(row.durationSeconds),
                  row.durationSeconds,
                  displayName,
                  board.boardName,
                  row.card.title,
                  row.card.list.name,
                  labels.map((label) => label.name).join("; "),
                  row.comment,
                ])
              : encodeCsvRow([
                  row.publicId,
                  row.workDate,
                  row.durationSeconds,
                  row.workspaceMember.publicId,
                  displayName,
                  getVisibleEmail(row.workspaceMember),
                  board.boardPublicId,
                  board.boardName,
                  row.card.publicId,
                  row.card.title,
                  row.card.cardNumber,
                  row.card.list.publicId,
                  row.card.list.name,
                  labels.map((label) => label.publicId).join(";"),
                  labels.map((label) => label.name).join("; "),
                  row.entryMethod,
                  row.timerStartedAt,
                  row.timerStoppedAt,
                  row.timerTimezone,
                  row.rawElapsedSeconds,
                  row.comment,
                  row.createdAt,
                  row.createdBy,
                  row.createdByUser?.name,
                  row.updatedAt,
                  row.updatedBy,
                  row.updatedByUser?.name,
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
