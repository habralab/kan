# Card due reminders

The web API schedules one job for each card reminder. The job contains the
card public ID and the absolute reminder instant. `card.dueReminderAt` is a
PostgreSQL `timestamptz`; the worker compares that value with the job payload
and never interprets the server's local time zone. Changing or removing the
reminder makes old jobs inert. Completed, archived and deleted cards are skipped.

The worker sends email to the card's currently active members. It skips jobs
more than 15 minutes late and records delivery for each recipient. The ledger
prevents routine retries from resending successful emails. SMTP and PostgreSQL
cannot be committed atomically, so a crash after SMTP acceptance but before
recording delivery can still cause a duplicate. No historical reminders are
backfilled.

Run the Drizzle migrations, then the `@kan/jobs` migration and
`@kan/worker migrate:queues` before starting the worker. The worker needs
`POSTGRES_URL`, `NEXT_PUBLIC_BASE_URL`, `EMAIL_FROM` and the same SMTP variables
used by the web process. It runs separately from the web app. Queue migration
is explicit and idempotent; worker startup does not alter the queue schema.
