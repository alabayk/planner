# Traffic reduction plan

## v72: server-side revision cache without SQL

- Calendar cycles check event IDs, versions and update timestamps instead of repeatedly downloading unchanged descriptions.
- Full event bodies are fetched only for new/changed IDs, in batches; inventory is paginated and includes deletion tombstones.
- Cache is private to a warm worker isolate, scoped to the backend credentials and capped at 8 MiB. Cold starts rebuild it safely; savings depend on isolate reuse.
- Manual Google sync and a full rebuild every 30 minutes recover unversioned administrative edits. Failed reads never fall back to stale data for calendar writes.
- Overlapping cron/manual calendar cycles in the same isolate share one operation. Reminder cadence remains one minute, Google cadence remains five minutes.
- No SQL migration is needed. This does not remove the host's read-only restriction or guarantee a monthly traffic percentage.

## v71: retired sections and schedule delivery

- Chat and the Together/invitations section are removed from the shipped UI, module cache, polling and worker cron.
- Legacy endpoints return 410 without querying Auth or the database. Old chat/invitation push jobs are excluded from delivery.
- Existing server-side history is left untouched; this release does not purge user data.
- The approved 18-class schedule for 26-31 October is bundled for offline queueing with stable IDs. It is marked uploaded only after an authorized server inventory confirms every expected ID.
- An expired session can be refreshed when its refresh token remains valid. Otherwise a re-login action is shown, without clearing the local cache/outbox.
- The freshness label advances only after a successful server read, not after a local midnight refresh.

The v70 details below describe the earlier optimization. All chat/invitation checks mentioned there are now retired.

## 1. Economy mode — implemented in v70

- Active client checks start at 60 seconds. With no changes, they slow to 5 minutes.
- Failed automatic checks back off to at most 15 minutes; manual refresh remains available.
- Hidden/offline clients do not poll. Opening chat triggers an immediate check.
- Closed chat and invitation badges are checked less often; invitation badges do not load event bodies.
- Invitation retry jobs query only records which still have pending work, not the full history.
- Heavy scheduled Google synchronization runs every 5 minutes. Reminder delivery still runs every minute.
- A calendar cycle reads the shared event snapshot once for both accounts, after a valid Google token is obtained.
- Repeated schedule seeding and unchanged deadline scheduling are avoided on the same device.

Tradeoff: automatic Google propagation may now take approximately 5 minutes plus processing/downstream calendar refresh time. Manual refresh can run sooner.

## 2. Revision-based client synchronization — implemented in v70

- Fetch a compact authorized inventory of active event IDs, versions and update timestamps.
- Fetch full event rows only for new or changed IDs, in batches of 50.
- Chat inventories contain IDs only; immutable message bodies are downloaded once.
- Paginate inventories by ID so API row limits do not silently omit data.
- Preserve pending offline edits and conflict snapshots. Prune only obsolete local cache rows after a successful complete inventory.
- No timestamp cursor: a backdated offline message or an incorrect device clock cannot skip a new ID.
- Manual refresh can reload full event bodies to recover unversioned administrative edits.
- No SQL migration or additional paid service is required for these changes.

## 3. Incremental Google/server synchronization — next

- Persist Google sync tokens and resume cursors; rebuild safely on token expiration.
- Avoid repeatedly transferring event and link snapshots, while preserving CAS conflict handling and retry recovery.
- Add server-side update stamps/indexes only once the database accepts writes.
- Keep notification scheduling independent of large calendar scans.

## 4. Metering and budget control — next

- Measure database response bytes and request counts by operation, without recording event text or secrets.
- Compare daily usage with the host's actual monthly accounting.
- Add budget warnings and an explicit emergency mode before the monthly quota is exhausted.

The current host's read-only quota restriction is not removed by this release. Permission repair SQL still needs a writable database. Real monthly savings have not yet been measured; no fixed percentage or quota guarantee is claimed.
