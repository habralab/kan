# Card due reminders

The web API schedules one job for each card reminder. The job contains the
card public ID and the absolute reminder instant. `card.dueReminderAt` is a
PostgreSQL `timestamptz`; the worker compares that value with the job payload
and never interprets the server's local time zone. Changing or removing the
reminder makes old jobs inert. Completed, archived and deleted cards are skipped.
Relative reminders require a due time. A custom reminder stores a local wall
time, day offset and IANA time zone on the card, and also resolves the next
absolute instant for the queue. Date-only due dates can use custom reminders.
At a daylight-saving gap the time moves to the first valid local minute; at an
overlap it uses the earlier occurrence. A recurring occurrence whose resolved
reminder would fall after a timed due date skips that reminder and retains its
configuration for subsequent occurrences.

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
