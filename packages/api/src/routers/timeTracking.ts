import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";
import {
  isValidIanaTimezone,
  isValidWorkDate,
} from "@kan/db/repository/timeTracking.utils";

import {
  timeTrackingActiveTimerSchema,
  timeTrackingCardSummarySchema,
  timeTrackingMemberOptionsSchema,
  timeTrackingSettingsSchema,
  timeTrackingWorklogSchema,
} from "../schemas";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  assertCanEdit,
  assertPermission,
  hasPermission,
} from "../utils/permissions";

const MAX_DURATION_SECONDS = 2_147_483_647;
const publicIdSchema = z.string().min(12);
const workDateSchema = z.string().refine(isValidWorkDate, "Invalid work date");
const timezoneSchema = z
  .string()
  .max(64)
  .refine(isValidIanaTimezone, "Invalid IANA timezone");
const durationSchema = z.number().int().positive().max(MAX_DURATION_SECONDS);
const commentSchema = z.string().max(10_000).nullable().optional();

const normalizeComment = (comment: string | null | undefined) => {
  if (comment === undefined) return undefined;
  const normalized = comment?.trim() ?? "";
  return normalized || null;
};

const encodeCursor = (cursor: { workDate: string; id: number }) =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");

const decodeCursor = (cursor: string) => {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    return z
      .object({ workDate: workDateSchema, id: z.number().int().positive() })
      .parse(parsed);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid cursor" });
  }
};

const handleRepositoryError = (error: unknown): never => {
  if (!(error instanceof timeTrackingRepo.TimeTrackingRepositoryError))
    throw error;

  if (
    error.code === "BOARD_NOT_FOUND" ||
    error.code === "CARD_NOT_FOUND" ||
    error.code === "WORKLOG_NOT_FOUND"
  )
    throw new TRPCError({ code: "NOT_FOUND", message: error.code });

  if (error.code === "MEMBER_NOT_FOUND")
    throw new TRPCError({ code: "FORBIDDEN", message: error.code });

  if (error.code === "TIMER_CONFLICT")
    throw new TRPCError({ code: "CONFLICT", message: error.code });

  throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.code });
};

const runRepositoryMutation = async <T>(mutation: () => Promise<T>) => {
  try {
    return await mutation();
  } catch (error) {
    return handleRepositoryError(error);
  }
};

type ListedWorklog = Awaited<
  ReturnType<typeof timeTrackingRepo.listWorklogsByCard>
>["items"][number];
type Worklog = NonNullable<
  Awaited<ReturnType<typeof timeTrackingRepo.getWorklogByPublicId>>
>;

const getMemberDisplayName = (
  displayName: string | null | undefined,
  email: string,
  publicId: string,
  showEmail: boolean,
) => {
  const normalizedDisplayName = displayName?.trim();
  if (normalizedDisplayName) return normalizedDisplayName;
  return showEmail ? email : `anonymous_${publicId}`;
};

const formatWorklog = (
  worklog: ListedWorklog | Worklog,
  capabilities: { canManage: boolean; canEdit: boolean; canDelete: boolean },
  userId: string,
) => {
  const own = worklog.workspaceMember.userId === userId;
  const showEmail =
    worklog.workspaceMember.workspace.showEmailsToMembers === true;
  const email = showEmail
    ? (worklog.workspaceMember.user?.email ?? worklog.workspaceMember.email)
    : null;

  return {
    publicId: worklog.publicId,
    workDate: worklog.workDate,
    durationSeconds: worklog.durationSeconds,
    comment: worklog.comment,
    entryMethod: worklog.entryMethod,
    timer:
      worklog.entryMethod === "timer" &&
      worklog.timerStartedAt &&
      worklog.timerStoppedAt &&
      worklog.timerTimezone &&
      worklog.rawElapsedSeconds !== null
        ? {
            startedAt: worklog.timerStartedAt,
            stoppedAt: worklog.timerStoppedAt,
            timezone: worklog.timerTimezone,
            rawElapsedSeconds: worklog.rawElapsedSeconds,
          }
        : null,
    member: {
      publicId: worklog.workspaceMember.publicId,
      displayName: getMemberDisplayName(
        worklog.workspaceMember.user?.name,
        worklog.workspaceMember.email,
        worklog.workspaceMember.publicId,
        showEmail,
      ),
      email,
      status: worklog.workspaceMember.status,
    },
    card: {
      publicId: worklog.card.publicId,
      title: worklog.card.title,
      cardNumber: worklog.card.cardNumber,
      list: {
        publicId: worklog.card.list.publicId,
        name: worklog.card.list.name,
      },
    },
    createdAt: worklog.createdAt,
    updatedAt: worklog.updatedAt,
    createdByDisplayName: worklog.createdByUser?.name ?? null,
    updatedByDisplayName: worklog.updatedByUser?.name ?? null,
    canEdit: capabilities.canManage || (own && capabilities.canEdit),
    canDelete: capabilities.canManage || (own && capabilities.canDelete),
  };
};

const formatMember = (member: {
  publicId: string;
  email: string;
  status: "invited" | "active" | "removed" | "paused";
  displayName: string | null;
  userEmail: string | null;
  showEmailsToMembers: boolean;
}) => ({
  publicId: member.publicId,
  displayName: getMemberDisplayName(
    member.displayName,
    member.email,
    member.publicId,
    member.showEmailsToMembers,
  ),
  email: member.showEmailsToMembers ? (member.userEmail ?? member.email) : null,
  status: member.status,
});

const getCapabilities = async (
  db: Parameters<typeof hasPermission>[0],
  userId: string,
  workspaceId: number,
) => {
  const [canManage, canEdit, canDelete] = await Promise.all([
    hasPermission(db, userId, workspaceId, "worklog:manage"),
    hasPermission(db, userId, workspaceId, "worklog:edit"),
    hasPermission(db, userId, workspaceId, "worklog:delete"),
  ]);
  return { canManage, canEdit, canDelete };
};

const requireUserId = (userId: string | undefined) => {
  if (!userId)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "User not authenticated",
    });
  return userId;
};

const requireActiveWorkspaceMember = async (
  db: Parameters<typeof hasPermission>[0],
  workspaceId: number,
  userId: string,
) => {
  const member = await timeTrackingRepo.getActiveWorkspaceMemberForUser(
    db,
    workspaceId,
    userId,
  );
  if (!member)
    throw new TRPCError({ code: "FORBIDDEN", message: "MEMBER_NOT_FOUND" });
  return member;
};

const canAccessTimerMetadata = async (
  db: Parameters<typeof hasPermission>[0],
  userId: string,
  timer: NonNullable<
    Awaited<ReturnType<typeof timeTrackingRepo.getActiveTimer>>
  >,
) =>
  timer.memberUserId === userId &&
  timer.memberStatus === "active" &&
  timer.memberDeletedAt === null &&
  timer.workspaceDeletedAt === null &&
  timer.boardDeletedAt === null &&
  timer.listDeletedAt === null &&
  timer.cardDeletedAt === null &&
  (await hasPermission(db, userId, timer.workspaceId, "board:view"));

const getVisibleTimer = async (
  db: Parameters<typeof hasPermission>[0],
  userId: string,
) => {
  const timer = await timeTrackingRepo.getActiveTimer(db, userId);
  if (!timer) return null;

  const hasAccess = await canAccessTimerMetadata(db, userId, timer);

  if (!hasAccess)
    return {
      publicId: timer.publicId,
      startedAt: timer.startedAt,
      startTimezone: timer.startTimezone,
      inaccessible: true as const,
    };

  return {
    publicId: timer.publicId,
    startedAt: timer.startedAt,
    startTimezone: timer.startTimezone,
    comment: timer.comment,
    inaccessible: false as const,
    card: {
      publicId: timer.cardPublicId,
      title: timer.cardTitle,
      cardNumber: timer.cardNumber,
    },
    board: { publicId: timer.boardPublicId, name: timer.boardName },
    workspace: {
      publicId: timer.workspacePublicId,
      name: timer.workspaceName,
    },
  };
};

const getWorklogOrThrow = async (
  db: Parameters<typeof hasPermission>[0],
  publicId: string,
) => {
  const worklog = await timeTrackingRepo.getWorklogByPublicId(db, publicId);
  if (!worklog || worklog.deletedAt)
    throw new TRPCError({ code: "NOT_FOUND", message: "WORKLOG_NOT_FOUND" });
  return worklog;
};

export const timeTrackingRouter = createTRPCRouter({
  getSettings: protectedProcedure
    .meta({
      openapi: {
        summary: "Get board time tracking settings",
        method: "GET",
        path: "/boards/{boardPublicId}/time-tracking/settings",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(z.object({ boardPublicId: publicIdSchema }))
    .output(timeTrackingSettingsSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.user?.id);
      const settings = await timeTrackingRepo.getBoardSettings(
        ctx.db,
        input.boardPublicId,
      );
      if (!settings)
        throw new TRPCError({ code: "NOT_FOUND", message: "BOARD_NOT_FOUND" });
      await requireActiveWorkspaceMember(ctx.db, settings.workspaceId, userId);
      await assertPermission(
        ctx.db,
        userId,
        settings.workspaceId,
        "board:view",
      );
      const canUpdate = await hasPermission(
        ctx.db,
        userId,
        settings.workspaceId,
        "board:edit",
      );
      return {
        ...settings,
        canUpdate: canUpdate || settings.createdBy === userId,
      };
    }),

  updateSettings: protectedProcedure
    .meta({
      openapi: {
        summary: "Update board time tracking settings",
        method: "PUT",
        path: "/boards/{boardPublicId}/time-tracking/settings",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(z.object({ boardPublicId: publicIdSchema, enabled: z.boolean() }))
    .output(timeTrackingSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.user?.id);
      const current = await timeTrackingRepo.getBoardSettings(
        ctx.db,
        input.boardPublicId,
      );
      if (!current)
        throw new TRPCError({ code: "NOT_FOUND", message: "BOARD_NOT_FOUND" });
      await requireActiveWorkspaceMember(ctx.db, current.workspaceId, userId);
      await assertPermission(ctx.db, userId, current.workspaceId, "board:view");
      await assertCanEdit(
        ctx.db,
        userId,
        current.workspaceId,
        "board:edit",
        current.createdBy,
      );
      try {
        await timeTrackingRepo.updateBoardSettings(ctx.db, {
          ...input,
          actorUserId: userId,
        });
      } catch (error) {
        handleRepositoryError(error);
      }
      const settings = await timeTrackingRepo.getBoardSettings(
        ctx.db,
        input.boardPublicId,
      );
      if (!settings)
        throw new TRPCError({ code: "NOT_FOUND", message: "BOARD_NOT_FOUND" });
      return { ...settings, canUpdate: true };
    }),

  listWorklogs: protectedProcedure
    .meta({
      openapi: {
        summary: "List time entries for a card",
        method: "GET",
        path: "/cards/{cardPublicId}/time-tracking/worklogs",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: publicIdSchema,
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().optional(),
      }),
    )
    .output(
      z.object({
        items: z.array(timeTrackingWorklogSchema),
        nextCursor: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.user?.id);
      const card = await timeTrackingRepo.getCardTimeTrackingContext(
        ctx.db,
        input.cardPublicId,
      );
      if (!card)
        throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
      await requireActiveWorkspaceMember(ctx.db, card.workspaceId, userId);
      await assertPermission(ctx.db, userId, card.workspaceId, "board:view");
      await assertPermission(ctx.db, userId, card.workspaceId, "worklog:view");
      const [result, capabilities] = await Promise.all([
        timeTrackingRepo.listWorklogsByCard(ctx.db, {
          cardPublicId: input.cardPublicId,
          limit: input.limit,
          cursor: input.cursor ? decodeCursor(input.cursor) : undefined,
        }),
        getCapabilities(ctx.db, userId, card.workspaceId),
      ]);
      return {
        items: result.items.map((item) =>
          formatWorklog(item, capabilities, userId),
        ),
        nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
      };
    }),

  getCardSummary: protectedProcedure
    .meta({
      openapi: {
        summary: "Get time tracking summary for a card",
        method: "GET",
        path: "/cards/{cardPublicId}/time-tracking/summary",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(z.object({ cardPublicId: publicIdSchema }))
    .output(timeTrackingCardSummarySchema)
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.user?.id);
      const card = await timeTrackingRepo.getCardTimeTrackingContext(
        ctx.db,
        input.cardPublicId,
      );
      if (!card)
        throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
      await requireActiveWorkspaceMember(ctx.db, card.workspaceId, userId);
      await assertPermission(ctx.db, userId, card.workspaceId, "board:view");
      await assertPermission(ctx.db, userId, card.workspaceId, "worklog:view");
      const [summary, canCreate, canManage] = await Promise.all([
        timeTrackingRepo.getCardWorklogSummary(ctx.db, card.cardId),
        hasPermission(ctx.db, userId, card.workspaceId, "worklog:create"),
        hasPermission(ctx.db, userId, card.workspaceId, "worklog:manage"),
      ]);
      return {
        totalSeconds: summary.totalSeconds,
        memberTotals: summary.memberTotals.map((member) => ({
          member: formatMember({
            publicId: member.memberPublicId,
            email: member.memberEmail,
            status: member.memberStatus,
            displayName: member.memberDisplayName,
            userEmail: member.userEmail,
            showEmailsToMembers: member.showEmailsToMembers,
          }),
          durationSeconds: member.durationSeconds,
        })),
        canCreate:
          (canCreate || canManage) &&
          card.settingsEnabled === true &&
          !card.isArchived,
        canStartTimer:
          canCreate && card.settingsEnabled === true && !card.isArchived,
        canManage,
      };
    }),

  getMemberOptions: protectedProcedure
    .meta({
      openapi: {
        summary: "List members available for time entries",
        method: "GET",
        path: "/cards/{cardPublicId}/time-tracking/members",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(z.object({ cardPublicId: publicIdSchema }))
    .output(timeTrackingMemberOptionsSchema)
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.user?.id);
      const card = await timeTrackingRepo.getCardTimeTrackingContext(
        ctx.db,
        input.cardPublicId,
      );
      if (!card)
        throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
      await requireActiveWorkspaceMember(ctx.db, card.workspaceId, userId);
      await assertPermission(ctx.db, userId, card.workspaceId, "board:view");
      const [canCreate, canManage] = await Promise.all([
        hasPermission(ctx.db, userId, card.workspaceId, "worklog:create"),
        hasPermission(ctx.db, userId, card.workspaceId, "worklog:manage"),
      ]);
      if (!canCreate && !canManage) throw new TRPCError({ code: "FORBIDDEN" });
      const members = await timeTrackingRepo.getTimeTrackingMemberOptions(
        ctx.db,
        card.workspaceId,
        canManage,
      );
      return {
        members: members
          .filter((member) => canManage || member.userId === userId)
          .map(formatMember),
        canManage,
      };
    }),

  createWorklog: protectedProcedure
    .meta({
      openapi: {
        summary: "Create a manual time entry",
        method: "POST",
        path: "/cards/{cardPublicId}/time-tracking/worklogs",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: publicIdSchema,
        workspaceMemberPublicId: publicIdSchema.optional(),
        workDate: workDateSchema,
        durationSeconds: durationSchema,
        comment: commentSchema,
      }),
    )
    .output(timeTrackingWorklogSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.user?.id);
      const card = await timeTrackingRepo.getCardTimeTrackingContext(
        ctx.db,
        input.cardPublicId,
      );
      if (!card)
        throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
      await assertPermission(ctx.db, userId, card.workspaceId, "board:view");
      const member = await requireActiveWorkspaceMember(
        ctx.db,
        card.workspaceId,
        userId,
      );
      const targetMemberPublicId =
        input.workspaceMemberPublicId ?? member.publicId;
      if (targetMemberPublicId === member.publicId)
        await assertPermission(
          ctx.db,
          userId,
          card.workspaceId,
          "worklog:create",
        );
      else
        await assertPermission(
          ctx.db,
          userId,
          card.workspaceId,
          "worklog:manage",
        );
      let created;
      try {
        created = await timeTrackingRepo.createManualWorklog(ctx.db, {
          cardPublicId: input.cardPublicId,
          workspaceMemberPublicId: targetMemberPublicId,
          workDate: input.workDate,
          durationSeconds: input.durationSeconds,
          comment: normalizeComment(input.comment) ?? null,
          actorUserId: userId,
        });
      } catch (error) {
        handleRepositoryError(error);
      }
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [worklog, capabilities] = await Promise.all([
        getWorklogOrThrow(ctx.db, created.publicId),
        getCapabilities(ctx.db, userId, card.workspaceId),
      ]);
      return formatWorklog(worklog, capabilities, userId);
    }),

  updateWorklog: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a time entry",
        method: "PUT",
        path: "/time-tracking/worklogs/{worklogPublicId}",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(
      z
        .object({
          worklogPublicId: publicIdSchema,
          workspaceMemberPublicId: publicIdSchema.optional(),
          workDate: workDateSchema.optional(),
          durationSeconds: durationSchema.optional(),
          comment: commentSchema,
        })
        .refine(
          (input) =>
            input.workspaceMemberPublicId !== undefined ||
            input.workDate !== undefined ||
            input.durationSeconds !== undefined ||
            input.comment !== undefined,
          "At least one change is required",
        ),
    )
    .output(timeTrackingWorklogSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.user?.id);
      const context = await timeTrackingRepo.getWorklogContext(
        ctx.db,
        input.worklogPublicId,
      );
      if (!context || context.deletedAt)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "WORKLOG_NOT_FOUND",
        });
      await requireActiveWorkspaceMember(ctx.db, context.workspaceId, userId);
      await assertPermission(ctx.db, userId, context.workspaceId, "board:view");
      const capabilities = await getCapabilities(
        ctx.db,
        userId,
        context.workspaceId,
      );
      const own = context.memberUserId === userId;
      if (!capabilities.canManage && !(own && capabilities.canEdit))
        throw new TRPCError({ code: "FORBIDDEN" });
      if (input.workspaceMemberPublicId && !capabilities.canManage) {
        const member = await timeTrackingRepo.getActiveWorkspaceMemberForUser(
          ctx.db,
          context.workspaceId,
          userId,
        );
        if (!member || member.publicId !== input.workspaceMemberPublicId)
          throw new TRPCError({ code: "FORBIDDEN" });
      }
      try {
        await timeTrackingRepo.updateWorklog(ctx.db, {
          worklogPublicId: input.worklogPublicId,
          workspaceId: context.workspaceId,
          workspaceMemberPublicId: input.workspaceMemberPublicId,
          workDate: input.workDate,
          durationSeconds: input.durationSeconds,
          comment: normalizeComment(input.comment),
          actorUserId: userId,
        });
      } catch (error) {
        handleRepositoryError(error);
      }
      const worklog = await getWorklogOrThrow(ctx.db, input.worklogPublicId);
      return formatWorklog(worklog, capabilities, userId);
    }),

  deleteWorklog: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a time entry",
        method: "DELETE",
        path: "/time-tracking/worklogs/{worklogPublicId}",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(z.object({ worklogPublicId: publicIdSchema }))
    .output(z.object({ publicId: z.string(), deleted: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.user?.id);
      const context = await timeTrackingRepo.getWorklogContext(
        ctx.db,
        input.worklogPublicId,
      );
      if (!context)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "WORKLOG_NOT_FOUND",
        });
      await requireActiveWorkspaceMember(ctx.db, context.workspaceId, userId);
      await assertPermission(ctx.db, userId, context.workspaceId, "board:view");
      const capabilities = await getCapabilities(
        ctx.db,
        userId,
        context.workspaceId,
      );
      const own = context.memberUserId === userId;
      if (!capabilities.canManage && !(own && capabilities.canDelete))
        throw new TRPCError({ code: "FORBIDDEN" });
      return runRepositoryMutation(() =>
        timeTrackingRepo.deleteWorklog(ctx.db, {
          ...input,
          workspaceId: context.workspaceId,
          actorUserId: userId,
        }),
      );
    }),

  getActiveTimer: protectedProcedure
    .meta({
      openapi: {
        summary: "Get the current user's active timer",
        method: "GET",
        path: "/time-tracking/timer",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(z.void())
    .output(timeTrackingActiveTimerSchema.nullable())
    .query(({ ctx }) => {
      const userId = requireUserId(ctx.user?.id);
      return getVisibleTimer(ctx.db, userId);
    }),

  startTimer: protectedProcedure
    .meta({
      openapi: {
        summary: "Start a timer for a card",
        method: "POST",
        path: "/cards/{cardPublicId}/time-tracking/timer",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: publicIdSchema,
        timezone: timezoneSchema,
        comment: commentSchema,
      }),
    )
    .output(
      z.object({
        timer: timeTrackingActiveTimerSchema,
        autoStoppedWorklog: timeTrackingWorklogSchema.nullable(),
        unchanged: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.user?.id);
      const card = await timeTrackingRepo.getCardTimeTrackingContext(
        ctx.db,
        input.cardPublicId,
      );
      if (!card)
        throw new TRPCError({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
      await requireActiveWorkspaceMember(ctx.db, card.workspaceId, userId);
      await assertPermission(ctx.db, userId, card.workspaceId, "board:view");
      await assertPermission(
        ctx.db,
        userId,
        card.workspaceId,
        "worklog:create",
      );
      const result = await runRepositoryMutation(() =>
        timeTrackingRepo.startTimer(ctx.db, {
          userId,
          cardPublicId: input.cardPublicId,
          timezone: input.timezone,
          comment: normalizeComment(input.comment) ?? null,
        }),
      );
      const timer = await getVisibleTimer(ctx.db, userId);
      if (!timer) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      let autoStoppedWorklog = null;
      if (result.autoStoppedWorklog) {
        const worklogContext = await timeTrackingRepo.getWorklogContext(
          ctx.db,
          result.autoStoppedWorklog.publicId,
        );
        if (
          worklogContext &&
          (await timeTrackingRepo.getActiveWorkspaceMemberForUser(
            ctx.db,
            worklogContext.workspaceId,
            userId,
          )) &&
          (await hasPermission(
            ctx.db,
            userId,
            worklogContext.workspaceId,
            "board:view",
          ))
        ) {
          const [worklog, capabilities] = await Promise.all([
            getWorklogOrThrow(ctx.db, result.autoStoppedWorklog.publicId),
            getCapabilities(ctx.db, userId, worklogContext.workspaceId),
          ]);
          autoStoppedWorklog = formatWorklog(worklog, capabilities, userId);
        }
      }
      return { timer, autoStoppedWorklog, unchanged: result.unchanged };
    }),

  stopTimer: protectedProcedure
    .meta({
      openapi: {
        summary: "Stop the current user's active timer",
        method: "POST",
        path: "/time-tracking/timer/stop",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(z.object({ timezone: timezoneSchema }))
    .output(
      z.object({
        stopped: z.boolean(),
        worklog: timeTrackingWorklogSchema.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.user?.id);
      const active = await timeTrackingRepo.getActiveTimer(ctx.db, userId);
      const result = await timeTrackingRepo.stopTimer(ctx.db, {
        userId,
        timezone: input.timezone,
      });
      if (!result.worklog || !active)
        return { stopped: result.stopped, worklog: null };
      const canView = await canAccessTimerMetadata(ctx.db, userId, active);
      if (!canView) return { stopped: true, worklog: null };
      const worklog = await getWorklogOrThrow(ctx.db, result.worklog.publicId);
      const capabilities = await getCapabilities(
        ctx.db,
        userId,
        active.workspaceId,
      );
      return {
        stopped: true,
        worklog: formatWorklog(worklog, capabilities, userId),
      };
    }),

  discardTimer: protectedProcedure
    .meta({
      openapi: {
        summary: "Discard the current user's active timer",
        method: "DELETE",
        path: "/time-tracking/timer",
        tags: ["Time Tracking"],
        protect: true,
      },
    })
    .input(z.void())
    .output(z.object({ discarded: z.boolean() }))
    .mutation(({ ctx }) => {
      const userId = requireUserId(ctx.user?.id);
      return timeTrackingRepo.discardTimer(ctx.db, userId);
    }),
});
