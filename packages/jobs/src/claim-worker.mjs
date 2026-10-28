import { PgBoss } from "pg-boss";

const connectionString = process.env.JOBS_TEST_POSTGRES_URL;
const schema = process.env.JOBS_TEST_SCHEMA;
const queue = process.env.JOBS_TEST_QUEUE;

if (!connectionString || !schema || !queue) {
  throw new Error(
    "The disposable PostgreSQL connection, schema and queue are required",
  );
}

const boss = new PgBoss({
  connectionString,
  schema,
  migrate: false,
  schedule: false,
  supervise: false,
});

await boss.start();
const [job] = await boss.fetch(queue);
if (!job) throw new Error("No job to claim");

process.stdout.write(`CLAIMED ${job.id}\n`);
setInterval(() => {}, 60_000);
