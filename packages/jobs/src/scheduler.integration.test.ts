import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { fromDrizzle, PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, test } from "vitest";

import { JobScheduler } from "./index.js";

// This test-only URL must be supplied explicitly; it must never fall back to POSTGRES_URL.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const connectionString = process.env.JOBS_TEST_POSTGRES_URL;
if (!connectionString) {
  throw new Error("JOBS_TEST_POSTGRES_URL must point to disposable PostgreSQL");
}

const schema = `jobs_test_${randomBytes(6).toString("hex")}`;
const pool = new Pool({ connectionString });
const db = drizzle(pool);
const bossOptions = {
  connectionString,
  schema,
  monitorIntervalSeconds: 1,
  superviseIntervalSeconds: 1,
  schedule: false,
};
const boss = new PgBoss(bossOptions);
const secondBoss = new PgBoss({
  ...bossOptions,
  migrate: false,
  supervise: false,
});

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(condition: () => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for worker");
    await sleep(100);
  }
}

beforeAll(async () => {
  await boss.start();
  await secondBoss.start();
});

afterAll(async () => {
  await secondBoss.stop({ graceful: true });
  await boss.stop({ graceful: true });
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
});

test("runs a delayed job only after its scheduled instant", async () => {
  const queue = "delayed";
  await boss.createQueue(queue);
  const handled: number[] = [];
  const workerId = await boss.work(queue, { pollingIntervalSeconds: 1 }, () => {
    handled.push(Date.now());
    return Promise.resolve();
  });

  try {
    const dueAt = Date.now() + 2_000;
    await boss.send(queue, { probe: true }, { startAfter: new Date(dueAt) });
    await sleep(500);
    expect(handled).toHaveLength(0);
    await waitFor(() => handled.length === 1);
    expect(handled[0]).toBeGreaterThanOrEqual(dueAt - 100);
  } finally {
    await boss.offWork(queue, { id: workerId });
  }
});

test("joins Drizzle's transaction on rollback and commit", async () => {
  const queue = "transactional";
  await boss.createQueue(queue);
  await pool.query(`CREATE TABLE "${schema}".marker (value text NOT NULL)`);

  await expect(
    db.transaction(async (transaction) => {
      await transaction.execute(
        sql.raw(
          `INSERT INTO "${schema}".marker (value) VALUES ('rolled-back')`,
        ),
      );
      await boss.send(
        queue,
        { value: "rolled-back" },
        {
          db: fromDrizzle(transaction, sql),
        },
      );
      throw new Error("rollback marker");
    }),
  ).rejects.toThrow("rollback marker");

  expect(
    (await pool.query(`SELECT * FROM "${schema}".marker`)).rows,
  ).toHaveLength(0);
  expect(await boss.findJobs(queue)).toHaveLength(0);

  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql.raw(`INSERT INTO "${schema}".marker (value) VALUES ('committed')`),
    );
    await boss.send(
      queue,
      { value: "committed" },
      {
        db: fromDrizzle(transaction, sql),
      },
    );
  });

  expect(
    (await pool.query(`SELECT * FROM "${schema}".marker`)).rows,
  ).toHaveLength(1);
  expect(await boss.findJobs(queue)).toHaveLength(1);
});

test("two workers claim each job once", async () => {
  const queue = "competing_workers";
  await boss.createQueue(queue);
  const handled: string[] = [];
  const handler = async (jobs: { id: string }[]) => {
    handled.push(...jobs.map((job) => job.id));
    await sleep(100);
  };
  const firstId = await boss.work(
    queue,
    { pollingIntervalSeconds: 1 },
    handler,
  );
  const secondId = await secondBoss.work(
    queue,
    { pollingIntervalSeconds: 1 },
    handler,
  );

  try {
    const sent = await Promise.all(
      Array.from({ length: 8 }, (_, index) => boss.send(queue, { index })),
    );
    await waitFor(() => handled.length === sent.length);
    expect(new Set(handled).size).toBe(sent.length);
    expect(new Set(handled)).toEqual(new Set(sent));
  } finally {
    await Promise.all([
      boss.offWork(queue, { id: firstId }),
      secondBoss.offWork(queue, { id: secondId }),
    ]);
  }
});

test("another worker recovers a job after its claimant is killed", async () => {
  const queue = "crash_recovery";
  await boss.createQueue(queue);
  const jobId = await boss.send(
    queue,
    { probe: true },
    { expireInSeconds: 1, retryLimit: 1, retryDelay: 1 },
  );
  expect(jobId).toBeTruthy();
  if (!jobId) throw new Error("Could not create crash recovery job");

  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./claim-worker.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        JOBS_TEST_POSTGRES_URL: connectionString,
        JOBS_TEST_SCHEMA: schema,
        JOBS_TEST_QUEUE: queue,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  try {
    await waitForClaim(child, jobId);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill("SIGKILL");
      await exited;
    }
  }

  const handled: string[] = [];
  const workerId = await secondBoss.work(
    queue,
    { pollingIntervalSeconds: 1 },
    (jobs) => {
      handled.push(...jobs.map((job) => job.id));
      return Promise.resolve();
    },
  );
  try {
    await waitFor(() => handled.length === 1, 20_000);
    expect(handled).toEqual([jobId]);
  } finally {
    await secondBoss.offWork(queue, { id: workerId });
  }
});

test("the application seam schedules transactionally and runs in a separate worker", async () => {
  const queue = "application_seam";
  await boss.createQueue(queue);
  const producer = new JobScheduler({
    connectionString,
    schema,
    mode: "producer",
  });
  const worker = new JobScheduler({ connectionString, schema, mode: "worker" });
  await producer.start();
  await worker.start();

  const handled: string[] = [];
  try {
    await worker.work(
      queue,
      (_data, id) => {
        handled.push(id);
        return Promise.resolve();
      },
      { pollingIntervalSeconds: 1 },
    );

    await expect(
      db.transaction(async (transaction) => {
        await producer.enqueue({
          name: queue,
          data: { marker: "rollback" },
          transaction,
        });
        throw new Error("rollback scheduler job");
      }),
    ).rejects.toThrow("rollback scheduler job");
    expect(await boss.findJobs(queue)).toHaveLength(0);

    const dueAt = Date.now() + 1_500;
    const id = await db.transaction((transaction) =>
      producer.enqueue({
        name: queue,
        data: { marker: "commit" },
        startAfter: new Date(dueAt),
        transaction,
      }),
    );
    await sleep(300);
    expect(handled).toHaveLength(0);
    await waitFor(() => handled.length === 1);
    expect(handled).toEqual([id]);
  } finally {
    await worker.stop();
    await producer.stop();
  }
});

async function waitForClaim(
  child: ChildProcessWithoutNullStreams,
  jobId: string,
) {
  let output = "";
  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    errors += chunk;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    output += chunk;
  });
  const deadline = Date.now() + 10_000;
  while (!output.includes(`CLAIMED ${jobId}`)) {
    if (child.exitCode !== null || Date.now() > deadline) {
      throw new Error(`Claim worker failed: ${errors.slice(0, 500)}`);
    }
    await sleep(100);
  }
}
