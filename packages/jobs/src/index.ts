import type { DrizzleTransactionLike, WorkOptions } from "pg-boss";
import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";

export const JOB_SCHEMA = "kan_jobs";

export type JobHandler = (
  data: Record<string, unknown>,
  id: string,
) => Promise<void>;

export interface EnqueueJob {
  name: string;
  data: Record<string, unknown>;
  startAfter?: Date;
  transaction?: DrizzleTransactionLike;
}

interface SchedulerOptions {
  connectionString: string;
  schema?: string;
  mode: "producer" | "worker";
}

export function requirePostgresUrl(): string {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("POSTGRES_URL is required for the job scheduler");
  }
  return connectionString;
}

export class JobScheduler {
  private readonly boss: PgBoss;
  private readonly mode: SchedulerOptions["mode"];

  constructor({
    connectionString,
    schema = JOB_SCHEMA,
    mode,
  }: SchedulerOptions) {
    if (!connectionString)
      throw new Error("A PostgreSQL connection is required");
    this.mode = mode;
    this.boss = new PgBoss({
      connectionString,
      schema,
      migrate: false,
      schedule: false,
      supervise: mode === "worker",
    });
  }

  onError(listener: (error: Error) => void): void {
    this.boss.on("error", listener);
  }

  async start(): Promise<void> {
    await this.boss.start();
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true });
  }

  async enqueue({
    name,
    data,
    startAfter,
    transaction,
  }: EnqueueJob): Promise<string> {
    const id = await this.boss.send(name, data, {
      startAfter,
      ...(transaction && { db: fromDrizzle(transaction, sql) }),
    });
    if (!id) throw new Error(`Could not enqueue job ${name}`);
    return id;
  }

  async work(
    name: string,
    handler: JobHandler,
    options: WorkOptions = {},
  ): Promise<string> {
    if (this.mode !== "worker")
      throw new Error("Only workers may register handlers");
    return this.boss.work<Record<string, unknown>>(
      name,
      options,
      async (jobs) => {
        for (const job of jobs) await handler(job.data, job.id);
      },
    );
  }
}
