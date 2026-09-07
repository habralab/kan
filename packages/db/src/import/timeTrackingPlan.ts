import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

import type {
  TimeTrackingImportedWorklogInput,
  TimeTrackingQuarantineInput,
} from "@kan/db/repository/timeTrackingImport.repo";
import { isValidWorkDate } from "@kan/db/repository/timeTracking.utils";

const MAX_DURATION_SECONDS = 2_147_483_647;
const REQUIRED_PLAN_FILES = ["worklogs.jsonl", "quarantine.jsonl"] as const;

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const nullableTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .nullable();
const optionalNullableString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value ?? null);
const sourceSchema = z.object({
  externalId: z.string().min(1).max(255),
  externalBoardId: z.string().min(1).max(255),
  externalCardId: z.string().min(1).max(255).nullable(),
  externalMemberId: z.string().min(1).max(255).nullable(),
  sourceCreatedAt: nullableTimestampSchema,
  sourceUpdatedAt: nullableTimestampSchema,
  sourceCreatedAtRaw: optionalNullableString(128),
  sourceUpdatedAtRaw: optionalNullableString(128),
  sourceTimestampTimezone: optionalNullableString(64),
  sourceCreatedByExternalMemberId: optionalNullableString(255),
  sourceCreatedByDisplayName: optionalNullableString(255),
  sourceUpdatedByExternalMemberId: optionalNullableString(255),
  sourceUpdatedByDisplayName: optionalNullableString(255),
  billable: z.boolean().nullable(),
  invoiced: z.boolean().nullable(),
  sourceHash: hashSchema,
});
const worklogSchema = sourceSchema.extend({
  boardPublicId: z.string().length(12),
  cardPublicId: z.string().length(12).nullable(),
  workspaceMemberPublicId: z.string().length(12).nullable(),
  workDate: z.string().refine(isValidWorkDate, "Invalid work date"),
  durationSeconds: z.number().int().positive().max(MAX_DURATION_SECONDS),
  comment: z.string().nullable(),
});
const quarantineSchema = sourceSchema.extend({
  reason: z.string().min(1).max(128),
  durationSeconds: z
    .number()
    .int()
    .positive()
    .max(MAX_DURATION_SECONDS)
    .nullable(),
  normalizedRecord: z.record(z.string(), z.unknown()),
  overrideReference: z.string().nullable().optional(),
});
const manifestSchema = z.object({
  format: z.literal("kan-time-tracking-import-plan-v1"),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  planId: z.string().min(1).max(255),
  provider: z.string().min(1).max(64),
  bundleVersion: z.string().min(1).max(128),
  counters: z
    .object({
      inputRecords: z.number().int().nonnegative(),
      inputSeconds: z.number().int().nonnegative(),
      importableRecords: z.number().int().nonnegative(),
      importableSeconds: z.number().int().nonnegative(),
      quarantinedRecords: z.number().int().nonnegative(),
      quarantinedSeconds: z.number().int().nonnegative(),
    })
    .passthrough(),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        bytes: z.number().int().nonnegative(),
        sha256: hashSchema,
      }),
    )
    .max(100),
});

export type TimeTrackingImportPlanManifest = z.infer<typeof manifestSchema>;

export interface TimeTrackingImportPlan {
  root: string;
  manifest: TimeTrackingImportPlanManifest;
  manifestContents: Buffer;
  worklogs: TimeTrackingImportedWorklogInput[];
  quarantine: TimeTrackingQuarantineInput[];
}

export interface TimeTrackingImportPlanArguments {
  planRootArgument: string;
  apply: boolean;
  preflight: boolean;
  updateExisting: boolean;
}

export const parseTimeTrackingImportPlanArguments = (
  args: string[],
): TimeTrackingImportPlanArguments => {
  const [planRootArgument, ...flags] = args;
  if (!planRootArgument || planRootArgument.startsWith("--"))
    throw new Error("A plan directory is required");

  const allowedFlags = new Set(["--apply", "--preflight", "--update-existing"]);
  const unknownFlag = flags.find((flag) => !allowedFlags.has(flag));
  if (unknownFlag) throw new Error(`Unknown argument: ${unknownFlag}`);
  if (new Set(flags).size !== flags.length)
    throw new Error("Duplicate command-line flag");

  const apply = flags.includes("--apply");
  const preflight = flags.includes("--preflight");
  const updateExisting = flags.includes("--update-existing");
  if (apply && preflight)
    throw new Error("--apply and --preflight are mutually exclusive");
  if (updateExisting && !apply)
    throw new Error("--update-existing requires --apply");

  return { planRootArgument, apply, preflight, updateExisting };
};

export const sha256 = (contents: Buffer | string) =>
  createHash("sha256").update(contents).digest("hex");

const isWithinRoot = (root: string, path: string) => {
  const relativePath = relative(root, path);
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
};

const resolvePlanFile = (root: string, name: string) => {
  if (name.includes("\\"))
    throw new Error(`Plan file must use forward slashes: ${name}`);

  const resolved = resolve(root, name);
  if (!isWithinRoot(root, resolved))
    throw new Error(`Plan file escapes its directory: ${name}`);

  const realPath = realpathSync(resolved);
  if (!isWithinRoot(root, realPath))
    throw new Error(`Plan file symlink escapes its directory: ${name}`);
  return realPath;
};

const readJsonLines = <Output, Input>(
  file: string,
  schema: z.ZodType<Output, z.ZodTypeDef, Input>,
): Output[] => {
  const records: Output[] = [];
  for (const [index, line] of readFileSync(file, "utf8")
    .split(/\r?\n/)
    .entries()) {
    if (!line.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${file}:${index + 1}: invalid JSON: ${message}`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success)
      throw new Error(
        `${file}:${index + 1}: ${result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    records.push(result.data);
  }
  return records;
};

const sumSeconds = (records: { durationSeconds: number | null }[]) =>
  records.reduce((sum, record) => sum + (record.durationSeconds ?? 0), 0);

export const loadTimeTrackingImportPlan = (
  planRootArgument: string,
): TimeTrackingImportPlan => {
  const root = realpathSync(resolve(planRootArgument));
  const manifestPath = resolvePlanFile(root, "manifest.json");
  const manifestContents = readFileSync(manifestPath);
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestContents.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${manifestPath}: invalid JSON: ${message}`);
  }
  const manifest = manifestSchema.parse(rawManifest);
  const filesByName = new Map<
    string,
    TimeTrackingImportPlanManifest["files"][number]
  >();
  for (const expected of manifest.files) {
    if (filesByName.has(expected.name))
      throw new Error(`Duplicate file in manifest: ${expected.name}`);
    filesByName.set(expected.name, expected);

    const contents = readFileSync(resolvePlanFile(root, expected.name));
    if (contents.byteLength !== expected.bytes)
      throw new Error(`Size mismatch for ${expected.name}`);
    if (sha256(contents) !== expected.sha256)
      throw new Error(`Checksum mismatch for ${expected.name}`);
  }
  for (const required of REQUIRED_PLAN_FILES) {
    if (!filesByName.has(required))
      throw new Error(
        `Required plan file is missing from manifest: ${required}`,
      );
  }

  const worklogs: TimeTrackingImportedWorklogInput[] = readJsonLines(
    resolvePlanFile(root, "worklogs.jsonl"),
    worklogSchema,
  );
  const quarantine: TimeTrackingQuarantineInput[] = readJsonLines(
    resolvePlanFile(root, "quarantine.jsonl"),
    quarantineSchema,
  );
  const externalIds = new Set<string>();
  for (const record of [...worklogs, ...quarantine]) {
    if (externalIds.has(record.externalId))
      throw new Error(`Duplicate externalId in plan: ${record.externalId}`);
    externalIds.add(record.externalId);
  }

  if (
    worklogs.length !== manifest.counters.importableRecords ||
    sumSeconds(worklogs) !== manifest.counters.importableSeconds ||
    quarantine.length !== manifest.counters.quarantinedRecords ||
    sumSeconds(quarantine) !== manifest.counters.quarantinedSeconds ||
    worklogs.length + quarantine.length !== manifest.counters.inputRecords ||
    sumSeconds(worklogs) + sumSeconds(quarantine) !==
      manifest.counters.inputSeconds
  )
    throw new Error("Plan counters do not match JSONL records");

  return { root, manifest, manifestContents, worklogs, quarantine };
};
