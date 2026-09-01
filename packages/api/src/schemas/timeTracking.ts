import { z } from "zod";

export const timeTrackingSettingsSchema = z.object({
  boardPublicId: z.string(),
  enabled: z.boolean(),
  roundingIntervalSeconds: z.number().int().positive(),
  minimumDurationSeconds: z.number().int().positive(),
  activeTimerCount: z.number().int().nonnegative(),
  updatedAt: z.date().nullable(),
  canUpdate: z.boolean(),
});

export const timeTrackingWorklogSchema = z.object({
  publicId: z.string(),
  workDate: z.string(),
  durationSeconds: z.number().int().positive(),
  comment: z.string().nullable(),
  entryMethod: z.enum(["manual", "timer"]),
  timer: z
    .object({
      startedAt: z.date(),
      stoppedAt: z.date(),
      timezone: z.string(),
      rawElapsedSeconds: z.number().int().nonnegative(),
    })
    .nullable(),
  member: z.object({
    publicId: z.string(),
    displayName: z.string(),
    email: z.string().nullable(),
    status: z.enum(["invited", "active", "removed", "paused"]),
  }),
  card: z.object({
    publicId: z.string(),
    title: z.string(),
    cardNumber: z.number().int().nullable(),
    list: z.object({
      publicId: z.string(),
      name: z.string(),
    }),
  }),
  createdAt: z.date(),
  updatedAt: z.date().nullable(),
  createdByDisplayName: z.string().nullable(),
  updatedByDisplayName: z.string().nullable(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});

export const timeTrackingActiveTimerSchema = z.union([
  z.object({
    publicId: z.string(),
    startedAt: z.date(),
    startTimezone: z.string(),
    inaccessible: z.literal(true),
  }),
  z.object({
    publicId: z.string(),
    startedAt: z.date(),
    startTimezone: z.string(),
    comment: z.string().nullable(),
    inaccessible: z.literal(false),
    card: z.object({
      publicId: z.string(),
      title: z.string(),
      cardNumber: z.number().int().nullable(),
    }),
    board: z.object({ publicId: z.string(), name: z.string() }),
    workspace: z.object({ publicId: z.string(), name: z.string() }),
  }),
]);
