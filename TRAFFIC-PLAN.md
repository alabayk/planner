# Traffic reduction plan

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
