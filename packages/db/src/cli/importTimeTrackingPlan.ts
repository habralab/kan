import { createDrizzleClient } from "@kan/db/client";
import {
  accumulateTimeTrackingImportResults,
  assertTimeTrackingImportCountersComplete,
  completeTimeTrackingImportRun,
  createEmptyTimeTrackingImportCounters,
  failTimeTrackingImportRun,
  importTimeTrackingWorklogBatch,
  quarantineTimeTrackingImportBatch,
  startTimeTrackingImportRun,
  validateTimeTrackingImportMappings,
} from "@kan/db/repository/timeTrackingImport.repo";
import {
  loadTimeTrackingImportPlan,
  parseTimeTrackingImportPlanArguments,
  sha256,
} from "@kan/db/timeTrackingImportPlan";

const batches = <T>(records: T[], size = 500) => {
  const result: T[][] = [];
  for (let index = 0; index < records.length; index += size)
    result.push(records.slice(index, index + size));
  return result;
};

if (process.argv.length < 3) {
  console.error(
    "Usage: pnpm time-tracking:import-plan <plan-directory> [--preflight|--apply] [--update-existing]",
  );
  process.exit(2);
}
const { planRootArgument, apply, preflight, updateExisting } =
  parseTimeTrackingImportPlanArguments(process.argv.slice(2));

const { manifest, manifestContents, worklogs, quarantine } =
  loadTimeTrackingImportPlan(planRootArgument);

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
        accumulateTimeTrackingImportResults(
          counters,
          batch,
          results,
          "worklogs",
        );
      }
      for (const batch of batches(quarantine)) {
        const results = await quarantineTimeTrackingImportBatch(db, {
          importRunPublicId: run.publicId,
          provider: manifest.provider,
          records: batch,
          updateExisting,
        });
        accumulateTimeTrackingImportResults(
          counters,
          batch,
          results,
          "quarantine",
        );
      }
      assertTimeTrackingImportCountersComplete(counters);
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
