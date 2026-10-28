import { JobScheduler, requirePostgresUrl } from "@kan/jobs";
import { createLogger } from "@kan/logger";

import { closeJobHandlers, jobHandlers } from "./job-handlers.js";

const log = createLogger("worker");
const scheduler = new JobScheduler({
  connectionString: requirePostgresUrl(),
  mode: "worker",
});

scheduler.onError((error) => log.error({ err: error }, "Job scheduler error"));

try {
  await scheduler.start();
  for (const { name, handler } of jobHandlers) {
    await scheduler.work(name, handler);
  }
  log.info({ handlers: jobHandlers.length }, "Job worker started");
} catch (error) {
  log.error({ err: error }, "Job worker failed to start");
  process.exitCode = 1;
  try {
    await scheduler.stop();
  } catch (stopError) {
    log.error(
      { err: stopError },
      "Job worker failed to stop after startup error",
    );
  }
  await closeJobHandlers();
}

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "Job worker stopping");
  try {
    await scheduler.stop();
  } catch (error) {
    log.error({ err: error }, "Job worker failed to stop");
    process.exitCode = 1;
  }
  await closeJobHandlers();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
