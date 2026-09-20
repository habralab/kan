import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cards,
  checklistItems,
  checklists,
  lists,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

export const getCalendarItemsByBoardPublicId = async (
  db: dbClient,
  boardPublicId: string,
) => {
  const rows = await db
    .select({
      publicId: checklistItems.publicId,
      title: checklistItems.title,
      completed: checklistItems.completed,
      dueDate: checklistItems.dueDate,
      dueDateHasTime: checklistItems.dueDateHasTime,
      cardPublicId: cards.publicId,
    })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklistItems.checklistId, checklists.id))
    .innerJoin(cards, eq(checklists.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .where(
      and(
        eq(boards.publicId, boardPublicId),
        isNull(boards.deletedAt),
        isNull(lists.deletedAt),
        isNull(cards.deletedAt),
        isNull(checklists.deletedAt),
        isNull(checklistItems.deletedAt),
        isNotNull(checklistItems.dueDate),
      ),
    )
    .orderBy(asc(checklistItems.dueDate), asc(checklistItems.index));

  return rows.filter(
    (item): item is typeof item & { dueDate: Date } => item.dueDate !== null,
  );
};

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(checklists)
    .where(isNull(checklists.deletedAt));
  return result[0]?.count ?? 0;
};

export const getCountItems = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(checklistItems)
    .where(isNull(checklistItems.deletedAt));
  return result[0]?.count ?? 0;
};

export const create = async (
  db: dbClient,
  checklistInput: {
    cardId: number;
    name: string;
    createdBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    const card = await tx.query.checklists.findFirst({
      where: and(
        eq(checklists.cardId, checklistInput.cardId),
        isNull(checklists.deletedAt),
      ),
      orderBy: desc(checklists.index),
    });

    const [result] = await tx
      .insert(checklists)
      .values({
        publicId: generateUID(),
        name: checklistInput.name,
        createdBy: checklistInput.createdBy,
        cardId: checklistInput.cardId,
        index: card ? card.index + 1 : 0,
      })
      .returning({
        id: checklists.id,
        publicId: checklists.publicId,
        name: checklists.name,
      });

    return result;
  });
};

export const createItem = async (
  db: dbClient,
  checklistItemInput: {
    checklistId: number;
    title: string;
    createdBy: string;
    completed?: boolean;
    dueDate?: Date | null;
    dueDateHasTime?: boolean;
    assigneeId?: number | null;
  },
) => {
  return db.transaction(async (tx) => {
    const lastItem = await tx.query.checklistItems.findFirst({
      where: and(
        eq(checklistItems.checklistId, checklistItemInput.checklistId),
        isNull(checklistItems.deletedAt),
      ),
      orderBy: desc(checklistItems.index),
    });

    const [result] = await tx
      .insert(checklistItems)
      .values({
        publicId: generateUID(),
        title: checklistItemInput.title,
        createdBy: checklistItemInput.createdBy,
        checklistId: checklistItemInput.checklistId,
        index: lastItem ? lastItem.index + 1 : 0,
        completed: checklistItemInput.completed ?? false,
        dueDate: checklistItemInput.dueDate ?? null,
        dueDateHasTime: checklistItemInput.dueDate
          ? (checklistItemInput.dueDateHasTime ?? false)
          : false,
        assigneeId: checklistItemInput.assigneeId ?? null,
      })
      .returning({
        id: checklistItems.id,
        publicId: checklistItems.publicId,
        title: checklistItems.title,
        completed: checklistItems.completed,
        dueDate: checklistItems.dueDate,
        dueDateHasTime: checklistItems.dueDateHasTime,
      });

    return result;
  });
};

export const getChecklistByPublicId = async (
  db: dbClient,
  checklistPublicId: string,
) => {
  const checklist = await db.query.checklists.findFirst({
    where: and(
      eq(checklists.publicId, checklistPublicId),
      isNull(checklists.deletedAt),
    ),
    with: {
      card: {
        with: {
          list: {
            with: {
              board: {
                with: {
                  workspace: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return checklist;
};

export const getChecklistItemByPublicIdWithChecklist = async (
  db: dbClient,
  checklistItemPublicId: string,
) => {
  const item = await db.query.checklistItems.findFirst({
    where: and(
      eq(checklistItems.publicId, checklistItemPublicId),
      isNull(checklistItems.deletedAt),
    ),
    with: {
      assignee: {
        columns: { publicId: true, email: true, status: true },
        with: { user: { columns: { name: true } } },
      },
      checklist: {
        with: {
          card: {
            with: {
              list: {
                with: {
                  board: {
                    with: { workspace: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return item;
};

export const updateItemById = async (
  db: dbClient,
  args: {
    id: number;
    title?: string;
    completed?: boolean;
    dueDate?: Date | null;
    dueDateHasTime?: boolean;
    assigneeId?: number | null;
  },
) => {
  const [result] = await db
    .update(checklistItems)
    .set({
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.completed !== undefined ? { completed: args.completed } : {}),
      ...(args.dueDate !== undefined
        ? {
            dueDate: args.dueDate,
            dueDateHasTime: args.dueDate
              ? (args.dueDateHasTime ?? false)
              : false,
          }
        : {}),
      ...(args.assigneeId !== undefined ? { assigneeId: args.assigneeId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(checklistItems.id, args.id))
    .returning({
      publicId: checklistItems.publicId,
      title: checklistItems.title,
      completed: checklistItems.completed,
      dueDate: checklistItems.dueDate,
      dueDateHasTime: checklistItems.dueDateHasTime,
    });

  return result;
};

export const softDeleteItemById = async (
  db: dbClient,
  args: { id: number; deletedAt: Date; deletedBy: string },
) => {
  const [result] = await db
    .update(checklistItems)
    .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
    .where(eq(checklistItems.id, args.id))
    .returning({ id: checklistItems.id });

  return result;
};

export const softDeleteAllItemsByChecklistId = async (
  db: dbClient,
  args: { checklistId: number; deletedAt: Date; deletedBy: string },
) => {
  const result = await db
    .update(checklistItems)
    .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
    .where(
      and(
        eq(checklistItems.checklistId, args.checklistId),
        isNull(checklistItems.deletedAt),
      ),
    )
    .returning({ id: checklistItems.id });

  return result;
};

export const softDeleteById = async (
  db: dbClient,
  args: { id: number; deletedAt: Date; deletedBy: string },
) => {
  const [result] = await db
    .update(checklists)
    .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
    .where(eq(checklists.id, args.id))
    .returning({ id: checklists.id });

  return result;
};

export const updateChecklistById = async (
  db: dbClient,
  args: { id: number; name: string },
) => {
  const [result] = await db
    .update(checklists)
    .set({ name: args.name, updatedAt: new Date() })
    .where(eq(checklists.id, args.id))
    .returning({ publicId: checklists.publicId, name: checklists.name });
  return result;
};

export const bulkCreate = async (
  db: dbClient,
  checklistInput: {
    cardId: number;
    name: string;
    createdBy: string;
    index: number;
  }[],
) => {
  if (checklistInput.length === 0) return [];

  return db.transaction(async (tx) => {
    const byCard = groupByKey(checklistInput, "cardId");

    const allValuesToInsert: {
      publicId: string;
      cardId: number;
      name: string;
      createdBy: string;
      index: number;
    }[] = [];

    for (const [cardId, items] of byCard.entries()) {
      const last = await tx.query.checklists.findFirst({
        columns: { index: true },
        where: and(eq(checklists.cardId, cardId), isNull(checklists.deletedAt)),
        orderBy: [desc(checklists.index)],
      });

      let nextIndex = last ? last.index + 1 : 0;

      const sorted = [...items].sort((a, b) => a.index - b.index);

      for (const item of sorted) {
        allValuesToInsert.push({
          publicId: generateUID(),
          ...item,
          index: nextIndex++,
        });
      }
    }

    const inserted = await tx
      .insert(checklists)
      .values(allValuesToInsert)
      .returning({ id: checklists.id, publicId: checklists.publicId });

    return inserted;
  });
};

export const bulkCreateItems = async (
  db: dbClient,
  checklistItemInput: {
    checklistId: number;
    title: string;
    createdBy: string;
    index: number;
    completed: boolean;
    dueDate?: Date | null;
    dueDateHasTime?: boolean;
    assigneeId?: number | null;
  }[],
) => {
  if (checklistItemInput.length === 0) return [];

  return db.transaction(async (tx) => {
    const byChecklist = groupByKey(checklistItemInput, "checklistId");

    const allValuesToInsert: {
      publicId: string;
      checklistId: number;
      title: string;
      createdBy: string;
      index: number;
      completed: boolean;
      dueDate?: Date | null;
      dueDateHasTime: boolean;
      assigneeId?: number | null;
    }[] = [];

    for (const [checklistId, items] of byChecklist.entries()) {
      const last = await tx.query.checklistItems.findFirst({
        columns: { index: true },
        where: and(
          eq(checklistItems.checklistId, checklistId),
          isNull(checklistItems.deletedAt),
        ),
        orderBy: [desc(checklistItems.index)],
      });

      let nextIndex = last ? last.index + 1 : 0;

      const sorted = [...items].sort((a, b) => a.index - b.index);

      for (const item of sorted) {
        allValuesToInsert.push({
          publicId: generateUID(),
          ...item,
          dueDateHasTime: item.dueDate ? (item.dueDateHasTime ?? false) : false,
          index: nextIndex++,
        });
      }
    }

    const inserted = await tx
      .insert(checklistItems)
      .values(allValuesToInsert)
      .returning({
        id: checklistItems.id,
        publicId: checklistItems.publicId,
        title: checklistItems.title,
        completed: checklistItems.completed,
        dueDate: checklistItems.dueDate,
        dueDateHasTime: checklistItems.dueDateHasTime,
      });

    return inserted;
  });
};

const groupByKey = <T extends Record<string, unknown>>(
  items: T[],
  keyField: keyof T,
): Map<number, T[]> => {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const key = item[keyField] as number;
    const arr = grouped.get(key) ?? [];
    arr.push(item);
    grouped.set(key, arr);
  }
  return grouped;
};

export const reorderItem = async (
  db: dbClient,
  args: {
    itemId: number;
    newIndex: number;
  },
) => {
  return db.transaction(async (tx) => {
    const item = await tx.query.checklistItems.findFirst({
      columns: {
        id: true,
        index: true,
        checklistId: true,
      },
      where: and(
        eq(checklistItems.id, args.itemId),
        isNull(checklistItems.deletedAt),
      ),
    });

    if (!item) {
      throw new Error(`Checklist item not found for ID ${args.itemId}`);
    }

    const currentIndex = item.index;
    const newIndex = args.newIndex;

    if (currentIndex === newIndex) {
      const unchanged = await tx.query.checklistItems.findFirst({
        columns: {
          publicId: true,
          title: true,
          completed: true,
          dueDate: true,
          dueDateHasTime: true,
        },
        where: and(
          eq(checklistItems.id, args.itemId),
          isNull(checklistItems.deletedAt),
        ),
      });

      if (!unchanged) {
        throw new Error(`Checklist item not found for ID ${args.itemId}`);
      }

      return unchanged;
    }

    if (currentIndex < newIndex) {
      await tx.execute(sql`
        UPDATE card_checklist_item
        SET index = index - 1
        WHERE "checklistId" = ${item.checklistId}
        AND index > ${currentIndex}
        AND index <= ${newIndex}
        AND "deletedAt" IS NULL
        `);
    } else {
      await tx.execute(sql`
        UPDATE card_checklist_item
        SET index = index + 1
        WHERE "checklistId" = ${item.checklistId}
        AND index >= ${newIndex}
        AND index < ${currentIndex}
        AND "deletedAt" IS NULL
        `);
    }

    const [updated] = await tx
      .update(checklistItems)
      .set({ index: newIndex })
      .where(eq(checklistItems.id, args.itemId))
      .returning({
        publicId: checklistItems.publicId,
        title: checklistItems.title,
        completed: checklistItems.completed,
        dueDate: checklistItems.dueDate,
        dueDateHasTime: checklistItems.dueDateHasTime,
      });

    if (!updated) {
      throw new Error(`Failed to update checklist item with ID ${args.itemId}`);
    }

    return updated;
  });
};
