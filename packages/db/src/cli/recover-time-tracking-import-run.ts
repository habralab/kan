import { createDrizzleClient } from "@kan/db/client";
import {
  getTimeTrackingImportRun,
  recoverTimeTrackingImportRun,
} from "@kan/db/repository/timeTrackingImport.repo";
import { parseTimeTrackingRecoveryArguments } from "@kan/db/timeTrackingImportRecovery";

const usage =
  "Usage: pnpm time-tracking:recover-run <run-public-id> --reason <reason> [--apply]";

const writeJson = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

if (process.argv.length < 3) {
  process.stderr.write(`${usage}\n`);
  process.exit(2);
}

const { importRunPublicId, reason, apply } = parseTimeTrackingRecoveryArguments(
  process.argv.slice(2),
);

if (!process.env.POSTGRES_URL)
  throw new Error(
    "POSTGRES_URL is required to inspect or recover an import run",
  );

const db = createDrizzleClient();
try {
  const run = await getTimeTrackingImportRun(db, importRunPublicId);
  if (!run) throw new Error("Import run not found");
  if (run.status !== "running")
    throw new Error(`Import run has status ${run.status}, not running`);

  writeJson({
    mode: apply ? "apply" : "dry-run",
    run: {
      publicId: run.publicId,
      provider: run.provider,
      bundleVersion: run.bundleVersion,
      status: run.status,
      startedAt: run.startedAt,
      counters: run.counters,
    },
    recoveryReason: reason,
    counterWarning:
      "Counters are the last persisted snapshot and may not include partial batches from an interrupted process.",
  });

  if (!apply) {
    process.stdout.write(
      "Dry run only; pass --apply to mark this run failed.\n",
    );
  } else {
    const recovered = await recoverTimeTrackingImportRun(db, {
      importRunPublicId,
      reason,
    });
    writeJson({
      recoveredRun: {
        publicId: recovered.publicId,
        status: recovered.status,
        finishedAt: recovered.finishedAt,
        error: recovered.error,
      },
    });
  }
} finally {
  await db.$client.end();
}
