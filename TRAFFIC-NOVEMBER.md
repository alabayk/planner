# November traffic controls

Apply `traffic-optimization.sql` once in the project SQL Editor. Expected result:
`traffic-schema-v1 ready`. This adds link revisions and indexes plus a private,
service-role-only idempotent usage collector. No events or existing event policies
are replaced. Before migration, missing link columns trigger a legacy fallback;
failed usage writes back off for 15 minutes.

Separately execute `import-schedule-20261102.sql`; its final counters must be
14 / 14. Neither file is confirmed applied by this code release.

Google synchronization now merges incremental pages into its complete snapshot.
The snapshot and cursor are cached privately in the Worker Cache API (no OAuth
credentials). Cold-cache eviction or an expired Google cursor rebuilds safely;
the cache is best-effort and is not a permanent database. Daily full refresh
keeps the recurrence expansion window moving. Deleted and unchanged events are
preserved for the existing conflict logic; the 10-write recovery backlog remains.

After migration, link polls download revisions, then bodies only for changed
links. Event and link snapshots now also use the private Worker Cache API so a
new isolate can restore them before checking revisions. Cache keys are hashed
and scoped to backend credentials, plus owner for links; no credentials are stored
in snapshot values. Cache failures fall back to database reads, never stale success.
Event full rebuilds happen daily instead of every 30 minutes; every normal cycle
still checks revisions and downloads changed/new rows, retaining deletions. Manual
refresh can still force a complete rebuild to recover unversioned maintenance edits.
Cache eviction and different locations can still cause cold reads; savings depend
on cache availability and actual use, not a guaranteed reduction percentage.

Worker logs `traffic-sample` payload byte counts, status and operation, never
query strings, tokens or event text. Samples include Supabase response bytes and
string request bodies; proxy streamed request bodies, compression, HTTP headers,
metering RPC overhead, Studio/direct requests and traffic bypassing this Worker
are not included. These are application estimates, NOT the hosting bill.

Counter batches use stable UUIDs for retry deduplication in SQL and are sent at
request/cron boundaries. Cold termination before a flush can lose a small batch;
failed unpersisted batches are not durable across worker eviction. Compare totals
with the hosting dashboard; this mechanism is not a hard global quota guarantee.

Warnings start at 1 GB/month or 50 MB/day (Moscow dates). Economy mode starts at
2 GB/month or 100 MB/day: automatic Google sync and client event polls slow to
15 minutes. Reminder delivery still runs EVERY minute. Manual refresh, offline
edits and outbox retry controls remain available. Budget resets on a new month;
daily totals reset on a new Moscow date.

The version 78 cache/budget changes do not require an additional SQL migration.
126 automated checks pass, including cold restores, changed/deleted rows, account
and credential separation, cache outages, reminders and existing calendar flows.
No production database access or migration execution was performed in this run.
Inspect access/host status and SQL results before claiming successful activation.
