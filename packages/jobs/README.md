# Jobs

`@kan/jobs` owns the PostgreSQL job queue. Producers and the independent
`apps/worker` process use the same package; card and checklist logic should
depend on this small API rather than on pg-boss directly. No product job is
registered yet, so starting the worker currently processes nothing.

The worker requires `POSTGRES_URL` and fails if it is absent. It does not fall
back to PGlite. Web producers and workers never migrate the job schema during
startup. Apply the separately invoked schema migration first:

```sh
pnpm --filter @kan/jobs build
POSTGRES_URL=postgresql://... pnpm --filter @kan/jobs migrate
pnpm --filter @kan/worker... build
POSTGRES_URL=postgresql://... pnpm --filter @kan/worker start
```

The migration is managed by pinned pg-boss 12.38.0 in the dedicated `kan_jobs`
schema. New job names must have their queues created explicitly before a worker
registers a handler. Review and rehearse future pg-boss version upgrades before
running `migrate` against a persistent database.

`JobScheduler.enqueue()` accepts a Drizzle transaction, which makes inserting a
job atomic with the surrounding domain update. It supports a `startAfter` date
for one-time delayed work. A handler may run again after a crash; business side
effects need their own idempotency rule.

Integration tests require a disposable PostgreSQL database. They create and
remove a random `jobs_test_*` schema, and exercise delayed work, transaction
rollback and commit, competing workers, and crash recovery:

```sh
JOBS_TEST_POSTGRES_URL=postgresql://... pnpm --filter @kan/jobs verify
```

Never point these tests at a production database. They auto-install the library
schema in their randomly named test schema. The tests shorten supervision to
one second; pg-boss defaults to 60 seconds.
