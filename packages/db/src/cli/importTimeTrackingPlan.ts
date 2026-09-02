import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import type {
  TimeTrackingImportedWorklogInput,
  TimeTrackingImportResult,
  TimeTrackingQuarantineInput,
} from "@kan/db/repository/timeTrackingImport.repo";
import { createDrizzleClient } from "@kan/db/client";
import {
  completeTimeTrackingImportRun,
  createEmptyTimeTrackingImportCounters,
  failTimeTrackingImportRun,
  importTimeTrackingWorklogBatch,
  quarantineTimeTrackingImportBatch,
  startTimeTrackingImportRun,
  validateTimeTrackingImportMappings,
} from "@kan/db/repository/timeTrackingImport.repo";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const nullableTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .nullable();
const sourceSchema = z.object({
  externalId: z.string().min(1).max(255),
  externalBoardId: z.string().min(1).max(255),
  externalCardId: z.string().min(1).max(255).nullable(),
  externalMemberId: z.string().min(1).max(255).nullable(),
  sourceCreatedAt: nullableTimestampSchema,
  sourceUpdatedAt: nullableTimestampSchema,
  billable: z.boolean().nullable(),
  invoiced: z.boolean().nullable(),
  sourceHash: hashSchema,
});
const worklogSchema = sourceSchema.extend({
  boardPublicId: z.string().length(12),
  cardPublicId: z.string().length(12).nullable(),
  workspaceMemberPublicId: z.string().length(12).nullable(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSeconds: z.number().int().positive(),
  comment: z.string().nullable(),
});
const quarantineSchema = sourceSchema.extend({
  reason: z.string().min(1).max(128),
  durationSeconds: z.number().int().positive().nullable(),
  normalizedRecord: z.record(z.string(), z.unknown()),
  overrideReference: z.string().nullable().optional(),
});
const manifestSchema = z.object({
  format: z.literal("kan-time-tracking-import-plan-v1"),
  schemaVersion: z.literal(1),
  planId: z.string().min(1),
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
  files: z.array(
    z.object({
      name: z.string().min(1),
      bytes: z.number().int().nonnegative(),
      sha256: hashSchema,
    }),
  ),
});

const sha256 = (contents: Buffer | string) =>
  createHash("sha256").update(contents).digest("hex");

const readJsonLines = <Output, Input>(
  file: string,
  schema: z.ZodType<Output, z.ZodTypeDef, Input>,
): Output[] =>
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const result = schema.safeParse(JSON.parse(line));
      if (!result.success)
        throw new Error(
          `${file}:${index + 1}: ${result.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}`,
        );
      return result.data;
    });

const batches = <T>(records: T[], size = 500) => {
  const result: T[][] = [];
  for (let index = 0; index < records.length; index += size)
    result.push(records.slice(index, index + size));
  return result;
};

const sumSeconds = (records: { durationSeconds: number | null }[]) =>
  records.reduce((sum, record) => sum + (record.durationSeconds ?? 0), 0);

const addResults = (
  counters: ReturnType<typeof createEmptyTimeTrackingImportCounters>,
  records: { durationSeconds: number | null }[],
  results: TimeTrackingImportResult[],
  quarantine: boolean,
) => {
  for (const [index, result] of results.entries()) {
    const seconds = records[index]?.durationSeconds ?? 0;
    if (quarantine && result.disposition !== "conflict") {
      counters.quarantinedRecords++;
      counters.quarantinedSeconds += seconds;
    }
    if (result.disposition === "inserted" && !quarantine) {
      counters.insertedRecords++;
      counters.insertedSeconds += seconds;
    } else if (result.disposition === "updated") counters.updatedRecords++;
    else if (result.disposition === "skipped") counters.skippedRecords++;
    else if (result.disposition === "conflict") counters.conflictRecords++;
  }
};

const planRootArgument = process.argv[2];
if (!planRootArgument) {
  console.error(
    "Usage: pnpm time-tracking:import-plan <plan-directory> [--preflight|--apply] [--update-existing]",
  );
  process.exit(2);
}
const planRoot = resolve(planRootArgument);
const apply = process.argv.includes("--apply");
const preflight = process.argv.includes("--preflight");
const updateExisting = process.argv.includes("--update-existing");
if (updateExisting && !apply)
  throw new Error("--update-existing requires --apply");

const manifestPath = resolve(planRoot, "manifest.json");
const manifestContents = readFileSync(manifestPath);
const manifest = manifestSchema.parse(JSON.parse(manifestContents.toString()));
for (const expected of manifest.files) {
  const contents = readFileSync(resolve(planRoot, expected.name));
  if (contents.byteLength !== expected.bytes)
    throw new Error(`Size mismatch for ${expected.name}`);
  if (sha256(contents) !== expected.sha256)
    throw new Error(`Checksum mismatch for ${expected.name}`);
}

const worklogs: TimeTrackingImportedWorklogInput[] = readJsonLines(
  resolve(planRoot, "worklogs.jsonl"),
  worklogSchema,
);
const quarantine: TimeTrackingQuarantineInput[] = readJsonLines(
  resolve(planRoot, "quarantine.jsonl"),
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

console.log(
  `Validated ${worklogs.length} worklogs and ${quarantine.length} quarantined records from ${manifest.planId}`,
);
if (!apply && !preflight) {
  console.log(
    "Validation only; pass --preflight to resolve Kan mappings or --apply to write to PostgreSQL",
  );
  process.exit(0);
}
if (!process.env.POSTGRES_URL)
  throw new Error("POSTGRES_URL is required for --preflight and --apply");

const db = createDrizzleClient();
try {
  const mappingSummary = await validateTimeTrackingImportMappings(db, worklogs);
  console.log(
    `Preflight resolved ${mappingSummary.boards} boards, ${mappingSummary.cards} cards and ${mappingSummary.workspaceMembers} workspace members`,
  );
  if (apply) {
    const counters = createEmptyTimeTrackingImportCounters(
      manifest.counters.inputRecords,
      manifest.counters.inputSeconds,
    );
    const run = await startTimeTrackingImportRun(db, {
      provider: manifest.provider,
      bundleVersion: manifest.bundleVersion,
      manifestSha256: sha256(manifestContents),
      inputRecords: manifest.counters.inputRecords,
      inputSeconds: manifest.counters.inputSeconds,
    });
    if (!run) throw new Error("Unable to create import run");

    try {
      for (const batch of batches(worklogs)) {
        const results = await importTimeTrackingWorklogBatch(db, {
          importRunPublicId: run.publicId,
          provider: manifest.provider,
          records: batch,
          updateExisting,
        });
        addResults(counters, batch, results, false);
      }
      for (const batch of batches(quarantine)) {
        const results = await quarantineTimeTrackingImportBatch(db, {
          importRunPublicId: run.publicId,
          provider: manifest.provider,
          records: batch,
          updateExisting,
        });
        addResults(counters, batch, results, true);
      }
      await completeTimeTrackingImportRun(db, {
        importRunPublicId: run.publicId,
        counters,
      });
      console.log(
        JSON.stringify({ runPublicId: run.publicId, counters }, null, 2),
      );
    } catch (error) {
      await failTimeTrackingImportRun(db, {
        importRunPublicId: run.publicId,
        counters,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
} finally {
  await db.$client.end();
}
