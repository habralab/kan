import { PgBoss } from "pg-boss";

import { JOB_SCHEMA, requirePostgresUrl } from "./index.js";

const boss = new PgBoss({
  connectionString: requirePostgresUrl(),
  schema: JOB_SCHEMA,
  migrate: true,
  schedule: false,
  supervise: false,
});

try {
  await boss.start();
} finally {
  await boss.stop({ graceful: true });
}
