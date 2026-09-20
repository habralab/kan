import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as checklistRepo from "@kan/db/repository/checklist.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { stripHtml } from "@kan/shared/utils";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission } from "../utils/permissions";

const checklistSchema = z.object({
  publicId: z.string().length(12),
  name: z.string().min(1).max(255),
});

const checklistItemSchema = z.object({
  publicId: z.string().length(12),
  title: z.string().min(1).max(500),
  completed: z.boolean(),
  dueDate: z.date().nullable(),
  dueDateHasTime: z.boolean(),
});

export const checklistRouter = createTRPCRouter({
  calendarByBoard: protectedProcedure
    .meta({
      openapi: {
        summary: "Get dated checklist items for a board calendar",
        method: "GET",
        path: "/boards/{boardPublicId}/calendar-checklist-items",
        description: "Retrieves dated checklist items for a board calendar",
        tags: ["Boards"],
        protect: true,
      },
    })
    .input(z.object({ boardPublicId: z.string().length(12) }))
    .output(
      z.array(
        z.object({
          publicId: z.string().length(12),
          title: z.string(),
          completed: z.boolean(),
          dueDate: z.date(),
          dueDateHasTime: z.boolean(),
          cardPublicId: z.string().length(12),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) {
        throw new TRPCError({
          message: "User not authenticated",
          code: "UNAUTHORIZED",
        });
      }

      const board = await boardRepo.getWorkspaceAndBoardIdByBoardPublicId(
        ctx.db,
        input.boardPublicId,
      );
      if (!board) {
        throw new TRPCError({
          message: `Board with public ID ${input.boardPublicId} not found`,
          code: "NOT_FOUND",
        });
      }

      await assertPermission(ctx.db, userId, board.workspaceId, "board:view");

      return checklistRepo.getCalendarItemsByBoardPublicId(
        ctx.db,
        input.boardPublicId,
      );
    }),
  create: protectedProcedure
    .meta({
      openapi: {
        summary: "Add a checklist to a card",
        method: "POST",
        path: "/cards/{cardPublicId}/checklists",
        description: "Adds a checklist to a card",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        name: z.string().min(1).max(255),
      }),
    )
    .output(checklistSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const card = await cardRepo.getWorkspaceAndCardIdByCardPublicId(
        ctx.db,
        input.cardPublicId,
      );

      if (!card)
        throw new TRPCError({
          message: `Card with public ID ${input.cardPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(ctx.db, userId, card.workspaceId, "card:edit");

      const newChecklist = await checklistRepo.create(ctx.db, {
        name: input.name,
        createdBy: userId,
        cardId: card.id,
      });

      if (!newChecklist?.id)
        throw new TRPCError({
          message: `Failed to create checklist`,
          code: "INTERNAL_SERVER_ERROR",
        });

      await cardActivityRepo.create(ctx.db, {
        type: "card.updated.checklist.added",
        cardId: card.id,
        toTitle: newChecklist.name,
        createdBy: userId,
      });

      return newChecklist;
    }),
  update: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a checklist",
        method: "PUT",
        path: "/checklists/{checklistPublicId}",
        description: "Updates a checklist by its public ID",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        checklistPublicId: z.string().length(12),
        name: z.string().min(1).max(255),
      }),
    )
    .output(z.object({ publicId: z.string().length(12), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const checklist = await checklistRepo.getChecklistByPublicId(
        ctx.db,
        input.checklistPublicId,
      );
      if (!checklist)
        throw new TRPCError({
          message: `Checklist with public ID ${input.checklistPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        checklist.card.list.board.workspace.id,
        "card:edit",
      );

      const previousName = checklist.name;

      const updated = await checklistRepo.updateChecklistById(ctx.db, {
        id: checklist.id,
        name: input.name,
      });

      if (!updated)
        throw new TRPCError({
          message: `Failed to update checklist`,
          code: "INTERNAL_SERVER_ERROR",
        });

      await cardActivityRepo.create(ctx.db, {
        type: "card.updated.checklist.renamed",
        cardId: checklist.cardId,
        fromTitle: previousName,
        toTitle: updated.name,
        createdBy: userId,
      });

      return updated;
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a checklist",
        method: "DELETE",
        path: "/checklists/{checklistPublicId}",
        description: "Deletes a checklist by its public ID",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(z.object({ checklistPublicId: z.string().length(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const checklist = await checklistRepo.getChecklistByPublicId(
        ctx.db,
        input.checklistPublicId,
      );
      if (!checklist)
        throw new TRPCError({
          message: `Checklist with public ID ${input.checklistPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        checklist.card.list.board.workspace.id,
        "card:edit",
      );

      await checklistRepo.softDeleteAllItemsByChecklistId(ctx.db, {
        checklistId: checklist.id,
        deletedAt: new Date(),
        deletedBy: userId,
      });

      const deleted = await checklistRepo.softDeleteById(ctx.db, {
        id: checklist.id,
        deletedAt: new Date(),
        deletedBy: userId,
      });

      if (!deleted)
        throw new TRPCError({
          message: `Failed to delete checklist`,
          code: "INTERNAL_SERVER_ERROR",
        });

      await cardActivityRepo.create(ctx.db, {
        type: "card.updated.checklist.deleted",
        cardId: checklist.cardId,
        fromTitle: checklist.name,
        createdBy: userId,
      });

      return { success: true };
    }),
  createItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Add an item to a checklist",
        method: "POST",
        path: "/checklists/{checklistPublicId}/items",
        description: "Adds an item to a checklist",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        checklistPublicId: z.string().length(12),
        title: z.string().min(1).max(500).transform(stripHtml),
      }),
    )
    .output(checklistItemSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const checklist = await checklistRepo.getChecklistByPublicId(
        ctx.db,
        input.checklistPublicId,
      );

      if (!checklist)
        throw new TRPCError({
          message: `Checklist with public ID ${input.checklistPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        checklist.card.list.board.workspace.id,
        "card:edit",
      );

      const newChecklistItem = await checklistRepo.createItem(ctx.db, {
        title: input.title,
        createdBy: userId,
        checklistId: checklist.id,
      });

      if (!newChecklistItem?.id)
        throw new TRPCError({
          message: `Failed to create checklist item`,
          code: "INTERNAL_SERVER_ERROR",
        });

      await cardActivityRepo.create(ctx.db, {
        type: "card.updated.checklist.item.added",
        cardId: checklist.cardId,
        toTitle: newChecklistItem.title,
        createdBy: userId,
      });

      return newChecklistItem;
    }),
  updateItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a checklist item",
        method: "PATCH",
        path: "/checklists/items/{checklistItemPublicId}",
        description:
          "Updates a checklist item (title/completed/due date/assignee)",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(
      z.object({
        checklistItemPublicId: z.string().length(12),
        title: z.string().min(1).max(500).transform(stripHtml).optional(),
        completed: z.boolean().optional(),
        index: z.number().int().min(0).optional(),
        dueDate: z.date().nullable().optional(),
        dueDateHasTime: z.boolean().optional(),
        assigneePublicId: z.string().length(12).nullable().optional(),
      }),
    )
    .output(checklistItemSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;

      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      if (
        input.title === undefined &&
        input.completed === undefined &&
        input.index === undefined &&
        input.dueDate === undefined &&
        input.assigneePublicId === undefined
      )
        throw new TRPCError({
          message: `At least one of title, completed, index, dueDate, or assigneePublicId must be provided`,
          code: "BAD_REQUEST",
        });

      const item = await checklistRepo.getChecklistItemByPublicIdWithChecklist(
        ctx.db,
        input.checklistItemPublicId,
      );

      if (!item)
        throw new TRPCError({
          message: `Checklist item with public ID ${input.checklistItemPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        item.checklist.card.list.board.workspace.id,
        "card:edit",
      );

      const previousTitle = item.title;
      let assigneeId: number | null | undefined;

      if (input.assigneePublicId !== undefined) {
        if (input.assigneePublicId === null) {
          assigneeId = null;
        } else {
          const member = await workspaceRepo.getMemberByPublicId(
            ctx.db,
            input.assigneePublicId,
            item.checklist.card.list.board.workspace.id,
          );
          if (!member)
            throw new TRPCError({
              message: `Member not found in this workspace`,
              code: "NOT_FOUND",
            });
          if (member.status !== "active" && member.status !== "invited")
            throw new TRPCError({
              message: `Inactive members cannot be assigned to checklist items`,
              code: "BAD_REQUEST",
            });
          assigneeId = member.id;
        }
      }

      if (input.dueDateHasTime !== undefined && input.dueDate === undefined)
        throw new TRPCError({
          message: `dueDate is required when dueDateHasTime is provided`,
          code: "BAD_REQUEST",
        });

      let updatedItem;

      if (
        input.title !== undefined ||
        input.completed !== undefined ||
        input.dueDate !== undefined ||
        assigneeId !== undefined
      ) {
        updatedItem = await checklistRepo.updateItemById(ctx.db, {
          id: item.id,
          title: input.title,
          completed: input.completed,
          dueDate: input.dueDate,
          dueDateHasTime: input.dueDateHasTime ?? item.dueDateHasTime,
          assigneeId,
        });
      }

      if (input.index !== undefined) {
        updatedItem = await checklistRepo.reorderItem(ctx.db, {
          itemId: item.id,
          newIndex: input.index,
        });
      }

      if (!updatedItem) {
        throw new TRPCError({
          message: `Failed to update checklist item`,
          code: "INTERNAL_SERVER_ERROR",
        });
      }

      // Log completion toggle
      if (input.completed !== undefined) {
        await cardActivityRepo.create(ctx.db, {
          type: input.completed
            ? "card.updated.checklist.item.completed"
            : "card.updated.checklist.item.uncompleted",
          cardId: item.checklist.cardId,
          toTitle: updatedItem.title,
          createdBy: userId,
        });
      }

      // Log title change
      if (input.title !== undefined && input.title !== previousTitle) {
        await cardActivityRepo.create(ctx.db, {
          type: "card.updated.checklist.item.updated",
          cardId: item.checklist.cardId,
          fromTitle: previousTitle,
          toTitle: updatedItem.title,
          createdBy: userId,
        });
      }

      if (
        input.dueDate !== undefined &&
        (item.dueDate?.getTime() !== updatedItem.dueDate?.getTime() ||
          item.dueDateHasTime !== updatedItem.dueDateHasTime)
      ) {
        await cardActivityRepo.create(ctx.db, {
          type: !item.dueDate
            ? "card.updated.checklist.item.dueDate.added"
            : !updatedItem.dueDate
              ? "card.updated.checklist.item.dueDate.removed"
              : "card.updated.checklist.item.dueDate.updated",
          cardId: item.checklist.cardId,
          toTitle: updatedItem.title,
          fromDueDate: item.dueDate ?? undefined,
          toDueDate: updatedItem.dueDate ?? undefined,
          toDueDateHasTime: updatedItem.dueDateHasTime,
          createdBy: userId,
        });
      }

      if (assigneeId !== undefined && assigneeId !== item.assigneeId) {
        await cardActivityRepo.create(ctx.db, {
          type: assigneeId
            ? "card.updated.checklist.item.assignee.assigned"
            : "card.updated.checklist.item.assignee.unassigned",
          cardId: item.checklist.cardId,
          toTitle: updatedItem.title,
          workspaceMemberId: assigneeId ?? item.assigneeId ?? undefined,
          createdBy: userId,
        });
      }

      return updatedItem;
    }),
  deleteItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete a checklist item",
        method: "DELETE",
        path: "/checklists/items/{checklistItemPublicId}",
        description: "Deletes a checklist item",
        tags: ["Cards"],
        protect: true,
      },
    })
    .input(z.object({ checklistItemPublicId: z.string().length(12) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId)
        throw new TRPCError({
          message: `User not authenticated`,
          code: "UNAUTHORIZED",
        });

      const item = await checklistRepo.getChecklistItemByPublicIdWithChecklist(
        ctx.db,
        input.checklistItemPublicId,
      );
      if (!item)
        throw new TRPCError({
          message: `Checklist item with public ID ${input.checklistItemPublicId} not found`,
          code: "NOT_FOUND",
        });
      await assertPermission(
        ctx.db,
        userId,
        item.checklist.card.list.board.workspace.id,
        "card:edit",
      );

      const deleted = await checklistRepo.softDeleteItemById(ctx.db, {
        id: item.id,
        deletedAt: new Date(),
        deletedBy: userId,
      });

      if (!deleted)
        throw new TRPCError({
          message: `Failed to delete item`,
          code: "INTERNAL_SERVER_ERROR",
        });

      await cardActivityRepo.create(ctx.db, {
        type: "card.updated.checklist.item.deleted",
        cardId: item.checklist.cardId,
        fromTitle: item.title,
        createdBy: userId,
      });

      return { success: true };
    }),
});
