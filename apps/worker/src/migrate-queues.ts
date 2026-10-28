import { PgBoss } from "pg-boss";

import { JOB_SCHEMA, requirePostgresUrl } from "@kan/jobs";

const boss = new PgBoss({
  connectionString: requirePostgresUrl(),
  schema: JOB_SCHEMA,
  migrate: false,
  schedule: false,
  supervise: false,
});

try {
  await boss.start();
  await boss.createQueue("card-due-reminder");
} finally {
  await boss.stop({ graceful: true });
}
