# Issue 97: event metadata reconciliation and implementation proposal

Status: review only. No app, rules, Functions, indexes or production data changed by this audit. Existing uncommitted work in the checkout was preserved.

## Source and verified evidence

Source: [PERRINN 424 Greenpower](https://docs.google.com/spreadsheets/d/1hM885tvrrUEp_6FDfRgioVTdUpNmd7SnPByL4zPGoS0/edit?usp=drivesdk), captured 19 October 2026. Workbook timezone is Europe/London. Captured metadata rows are in [the source snapshot](greenpower-event-source-2026-10-19.json). Row numbers below refer to that capture and are provenance, not permanent identities.

Two read-only Firestore queries, each limited to 100 documents, returned 73 import checkpoints and 74 day records: 147 metadata documents total, concurrency one, no query retries and no writes. The initial sandbox network attempt failed; the successful authorized network run is recorded in [live metadata](greenpower-event-live-metadata-2026-10-19.json). No raw Firestore chunks or external source data were downloaded.

All 73 local source snapshots match both current checkpoint SHA-256 values and the reviewed import evidence. Counts, checkpoint completion and first/last timestamps match; day counts also match. Total: **331,097 historical samples**. This is provenance verification, not a fresh byte-for-byte check of current stored samples. The prior [Goodwood](greenpower-goodwood-import-2026-10-19.json) and [remaining historical import](greenpower-remaining-2026-resume-2026-10-19.json) audits contain that earlier verification.

There are 53 source rows: nine events, 22 full dyno runs, 22 battery tests. Of these, 49 have a corresponding completed import date and remain **review_needed**. Four future battery tests have no imported date and are **unmatched**. There are 37 imported dates without a candidate from these three metadata tables; retain them as recordings awaiting metadata. A shared date never proves an event/session assignment.

[Machine-readable reconciliation](greenpower-event-reconciliation-2026-10-19.json) contains every source row, actual observed timestamps, sample boundary IDs, checksum evidence and recording blocks. Blocks use gaps greater than ten minutes solely to expose recordings for review. They do not define sessions, classify races or authorize assignments. No mapping is marked matched.

## Race and track-test candidates

The time range is the entire imported date, not the race/test duration. Multiple recording blocks on one date remain separate evidence until reviewed.

| Sheet row | UK date | Proposed name | Driver / result | Observed UK range | Samples | Recording blocks |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | 2026-05-06 | Mallory park race | Zack / P2 | 08:02:55–16:03:05 | 1673 | 2 |
| 4 | 2026-05-24 | Goodwood race | Laura / DNF | 07:52:53–15:03:01 | 8077 | 2 |
| 5 | 2026-05-27 | Castle Combe test | — | 17:10:29–20:03:18 | 3454 | 1 |
| 6 | 2026-05-31 | Castle Combe race | Zack / P3 | 09:02:19–16:15:42 | 7902 | 2 |
| 7 | 2026-06-07 | Bedford race | Zack / P1 | 07:36:27–15:25:20 | 7048 | 2 |
| 8 | 2026-08-14 | Castle Combe test | — | 17:12:42–20:20:43 | 3753 | 1 |
| 9 | 2026-09-12 | Dunsfold race | Zack / P2 | 07:29:08–13:39:09 | 4733 | 2 |
| 10 | 2026-09-24 | Mallory park race | Laura / P4 | 08:22:15–16:06:51 | 6428 | 2 |
| 11 | 2026-10-18 | Goodwood finals | Zack / P5 | 08:08:14–14:54:09 | 3252 | 3 |

Preserve the spreadsheet values without fabricated defaults. Ambient, Temp and mass columns lack explicit units; Temp also lacks a sensor definition. Keep their original labels/values in provenance until units and meaning are confirmed. The driver-mass note says no helmet. Missing drivers/results remain absent. The source question mark for Dunsfold Temp is unknown.

## Full dyno run candidates

Confirmed user decision: numbered runs are separate sessions within a named dyno event. Proposed same-date event groupings below are editable review candidates, not a rule that one date equals one event. The nearest block is chosen by its first timestamp, without asserting that it belongs to the run. Times here are BST (UTC+01:00).

| Run / row | Proposed event date | Documented start | Nearest observed block | Start difference (min) | Samples in block |
| --- | --- | --- | --- | --- | --- |
| 1 / 2 | 2026-06-14 | 09:30 | 09:34:59–11:46:20 | 4.99 | 2629 |
| 2 / 3 | 2026-06-14 | 16:00 | 15:51:04–18:08:27 | -8.92 | 2736 |
| 3 / 4 | 2026-06-15 | 09:30 | 09:30:48–11:43:45 | 0.81 | 2660 |
| 4 / 5 | 2026-06-16 | 09:00 | 09:08:53–11:34:59 | 8.89 | 2922 |
| 5 / 6 | 2026-06-16 | 14:00 | 14:07:29–16:28:35 | 7.5 | 2822 |
| 6 / 7 | 2026-06-17 | 09:00 | 08:55:42–12:03:17 | -4.28 | 3753 |
| 7 / 8 | 2026-06-17 | 16:00 | 16:11:03–18:29:45 | 11.05 | 2776 |
| 8 / 10 | 2026-06-18 | 10:30 | 09:43:10–13:09:33 | -46.82 | 4129 |
| 9 / 11 | 2026-06-19 | 08:30 | 08:19:45–10:17:09 | -10.25 | 2349 |
| 10 / 13 | 2026-06-20 | 10:00 | 10:02:07–12:27:04 | 2.12 | 2901 |
| 11 / 14 | 2026-06-21 | 09:30 | 09:31:35–10:43:01 | 1.6 | 1433 |
| 12 / 15 | 2026-06-22 | 07:00 | 06:20:10–08:43:58 | -39.83 | 2877 |
| 13 / 16 | 2026-06-23 | 09:00 | 08:44:53–10:58:51 | -15.11 | 2681 |
| 14 / 17 | 2026-06-24 | 07:00 | 06:59:50–09:15:50 | -0.16 | 2720 |
| 15 / 18 | 2026-06-25 | 07:00 | 06:59:51–09:12:19 | -0.15 | 2650 |
| 16 / 19 | 2026-06-26 | 07:00 | 06:59:53–09:09:41 | -0.1 | 2598 |
| 17 / 21 | 2026-06-30 | 09:30 | 09:30:17–12:08:39 | 0.29 | 3167 |
| 18 / 22 | 2026-07-01 | 09:00 | 08:59:42–10:53:18 | -0.29 | 2273 |
| 19 / 24 | 2026-07-02 | 09:00 | 09:01:47–10:56:07 | 1.79 | 2288 |
| 20 / 25 | 2026-07-03 | 09:00 | 08:54:20–11:19:05 | -5.66 | 2896 |
| 21 / 26 | 2026-07-06 | 10:00 | 09:44:41–12:30:44 | -15.32 | 3321 |
| 22 / 27 | 2026-07-07 | 10:00 | 09:44:53–12:06:29 | -15.1 | 2833 |

Runs 1/2, 4/5 and 6/7 demonstrate multiple runs on the same date. Keep distinct IDs and configuration per run. Several dates contain additional recording blocks. Preserve batteries, motor, generator, gear/wheel and ratio per run. Retain DNF as an outcome, not a number. The source Watt heading is ambiguous; do not reinterpret it as W or Wh.

## Battery test candidates

There are no documented start/end times for these tests. Keep the numbered records distinct; do not allocate a day or timestamp block to an individual battery by row order, count, similarity or date alone.

| Test / row | UK date | Battery label | Energy Wh | Evidence |
| --- | --- | --- | --- | --- |
| 1 / 2 | 2026-07-13 | 1 (1&2) | 250 | Same-date recording; session needs review |
| 2 / 3 | 2026-07-13 | 2 (1&2) | 251 | Same-date recording; session needs review |
| 3 / 4 | 2026-07-13 | 3 (3&4) | 275 | Same-date recording; session needs review |
| 4 / 5 | 2026-07-13 | 4 (3&4) | 274 | Same-date recording; session needs review |
| 5 / 6 | 2026-07-14 | 3 (3&4 9H) | 272 | Same-date recording; session needs review |
| 6 / 7 | 2026-07-14 | 4 (3&4 9H) | 270 | Same-date recording; session needs review |
| 7 / 8 | 2026-07-21 | 5 (5&6) | 269 | Same-date recording; session needs review |
| 8 / 9 | 2026-07-21 | 6 (5&6) | 266 | Same-date recording; session needs review |
| 9 / 10 | 2026-07-22 | 5 (5&6) | 273 | Same-date recording; session needs review |
| 10 / 11 | 2026-07-22 | 6 (5&6) | 269 | Same-date recording; session needs review |
| 11 / 12 | 2026-07-23 | 3 (3&5) | 274 | Same-date recording; session needs review |
| 12 / 13 | 2026-07-23 | 5 (3&5) | 280 | Same-date recording; session needs review |
| 13 / 14 | 2026-07-24 | 4 (4&6) | 268 | Same-date recording; session needs review |
| 14 / 15 | 2026-07-24 | 6 (4&6) | 271 | Same-date recording; session needs review |
| 15 / 16 | 2026-09-19 | 1 (1&2) cold | 219 | Same-date recording; session needs review |
| 16 / 17 | 2026-09-19 | 2 (1&2) cold | 224 | Same-date recording; session needs review |
| 17 / 18 | 2026-09-20 | 1 (1&2) | 265 | Same-date recording; session needs review |
| 18 / 19 | 2026-09-20 | 2 (1&2) | 268 | Same-date recording; session needs review |
| 19 / 20 | 2026-10-20 | 3 (3&5) | unknown (#DIV/0!) | Future-dated; no imported recording |
| 20 / 21 | 2026-10-20 | 5 (3&5) | unknown (#DIV/0!) | Future-dated; no imported recording |
| 21 / 22 | 2026-10-21 | 4 (4&6) | unknown (#DIV/0!) | Future-dated; no imported recording |
| 22 / 23 | 2026-10-21 | 6 (4&6) | unknown (#DIV/0!) | Future-dated; no imported recording |

Tests 19–22 are dated 20–21 October 2026, after this audit date. Their #DIV/0! results remain unknown. Leave these in the review manifest until Nico decides whether to create planned events. Do not create fictional historical sessions.

## Current implementation and integration boundaries

The production route /424-greenpower-telemetry uses GreenpowerTelemetryComponent and component-scoped services. GreenpowerTelemetryService selects UK days and reads chunks in document-ID order; history uses eventAt, live uses receivedAt. Dates load 30 per explicit request. History loading already has a 50-page / 64 MiB action budget. These limits bound a load action, not lifetime session reads.

Persisted raw data is under GreenpowerTelemetry/424/days/{date}/chunks/{chunkId}; import provenance is under imports/{importId}. Importer records contain actual source firstAt/lastAt and checksums, but neither the reader nor importer defines event/run identities. Raw retention, historical aliases, source IDs and the phone ingestion endpoint must remain compatible.

The existing Edit workflow combines shared view settings with track editing, uses PermissionsService and saves with revision conflict checks. Extend this entry point with an Event section. Keep its existing view/track responsibility and save behavior explicit; metadata saves must not silently save unrelated dirty settings.

Concurrent checkout changes appeared during the audit: greenpowerDatasetTrack.ts and related service/rule edits add a per-day track selection at days/{day}/config/track, saved with the shared view transaction. This work belongs to another ongoing change and was not modified or validated here. Re-read the final implementation before integration. Preserve that path, its revision checks and atomic view/track save; selecting or editing an event/session must not silently change the shared day track. Keep GPS mismatch feedback when a selected recording does not fit that day’s track. No session-specific track migration is proposed.

The inspected Firestore rules permit all real signed-in users to read GreenpowerTelemetry and permit client writes to the named view and track-definition paths; the concurrent draft also grants validated per-day track-selection writes. The perrinnAdmin claim is the shared trusted role. New event/session/audit paths inherit signed-in reads and denied client writes. This audit did not export live rules. The HTTP ingestion handler in functions/greenpowerTelemetry.f.js and transactional sample appender in functions/utils/greenpowerTelemetry.js should remain unchanged.

Existing coverage includes npm run test:greenpower, separate emulator checks, desktop/mobile UI harnesses, build and lint. No app code was changed or tested by this audit. Reconciliation assertions checked the 73 checksums, completed checkpoints, source/day counts, timestamp extrema and 53 candidate count.

## Proposed persisted contract — approval required before implementation

Keep all new metadata below GreenpowerTelemetry/424. Preserve every existing path and raw sample shape.

- events/{eventId}: stable identity, name, type, local date/time and Europe/London timezone, location, description, notes, driver/operator, result, bounded tags, optional engineering values with explicit units, metadataStatus, source provenance, sessionCount, revision, updatedAt and updatedBy. Unknown optional fields are absent. Event date/time is documented event metadata and must not be substituted for actual sample timestamps. Events can have zero sessions and the same date can have multiple events.

- sessions/{sessionId}: stable identity, eventId, run number/name, actual firstAt/lastAt, source/import references, sample-range locators, optional engineering overrides, provenance/status and revision audit fields. Create a linked telemetry session only after its actual recording range is reviewed. Unmatched test rows stay in the manifest rather than becoming invented recording sessions. Reassigning a session changes eventId while preserving sessionId.

- A sample-range locator identifies the immutable day and first/last chunk plus boundary sample IDs/positions and actual timestamps. A session can reference multiple day segments, supporting midnight crossings. Verify locators against imported chunks before writes. Do not persist diagnostic gap blocks as approved sessions. Filter boundary chunks to exact sample IDs/positions; chunks may be shared by adjacent runs. Avoid timestamp-only slicing when samples share timestamps.

- metadataChanges/{changeId}: immutable audit action containing actor, server time, action, affected IDs and bounded before/after metadata; no raw sample copies. metadataRequests/{requestId}: idempotency key and request checksum/result. These inherit the existing signed-in read policy; all metadata writes go through the trusted callable or authorized operator backfill.

- Keep IDs independent of editable names/dates and sheet row positions. The reviewed backfill manifest assigns stable IDs and source keys once. A rerun with the same manifest is zero-write; changed input or revisions stop for review instead of replacing edited metadata.

## Proposed backend implementation — explicit approval required

Add functions/greenpowerEvents.f.js exporting authenticated callable **greenpowerEventEdit**, add validation/transaction logic in functions/utils/greenpowerEvents.js, and export it from functions/main.js. These are the complete proposed Cloud Functions changes. No change to phone ingestion, raw append/import logic, payments or other handlers.

The callable requires a real authenticated UID and boolean perrinnAdmin claim on every request. It validates field allowlists, lengths, supported types, explicit units, finite measurements, source ranges, session/event references, expected revisions and request idempotency. It atomically writes edited events/sessions and the audit/idempotency records. Operations cover event/session create/update, session association/reassignment and reviewed split/merge. Split/merge changes metadata only and never deletes or rewrites raw samples. Keep the source event available while any sessions remain; mark it superseded only after explicit completion.

Bound one edit request to 128 KiB, four events, twenty sessions and twenty recording segments total. With at most two boundary-chunk reads and two day/import reads per segment plus the twenty session/four event documents and one request record, budget at most 105 document reads per attempt, three transaction attempts (315 reads), and 26 committed metadata/audit/request writes. Request-local reuse reduces duplicate reads; do not claim monetary cost or latency without measurement. Larger operations require explicit continuation and never scan for all sessions. Audit snapshots must be capped below the Firestore document-size limit. Add validation tests for both exhausted budgets and stale/conflicting edits.

No Firebase rule change is proposed: current rules already deny client writes to these new paths and limit reads to signed-in users. Test those inherited boundaries for unauthenticated, ordinary-user, admin and cross-user requests; the callable must enforce authorization because Admin SDK bypasses rules.

## Client, query and layout proposal

Add a metadata service for data access/callable actions, focused event-selector and event-editor components, typed metadata helpers, and narrow integrations in the existing telemetry service/component. Register components through the current NgModule. Keep components under the repository 500-line total requirement and preserve AngularFire compatibility APIs.

The history selector shows event name, type and date, then separately loads the chosen event’s sessions. The selected event name becomes the visible title. Retain Live and a Recorded days fallback so unassigned historical data and old records stay accessible. Provide an explicit All sessions view where ranges have been reviewed; never silently expand a selected session to its entire date. Future events without telemetry show a compact empty state.

Use server queries with a 30-record result limit and one page per user action for events, sessions and remaining recordings. Provide type/date/location filters; use exact normalized location keys and explicit date ranges rather than downloading unrelated events to filter. Maintain the required equality-plus-date and eventId-plus-firstAt indexes in firestore.indexes.json. Resolve precise index definitions from the final queries and compare live/repository indexes before any deployment. No unbounded name search or automatic pagination is proposed.

Stop list/document subscriptions and pending loads on account/selection change or destruction, reuse already loaded selected metadata, and ignore stale responses. Use one selected-event and one selected-session listener only while needed; list pages use one-shot reads. Listener reconnects can reread those documents. Existing view/track listeners remain separately owned.

A session load shares one global 50-query / 64 MiB history budget across all its day segments, with no more than twenty segments per selected load. Fetch only its chunk ranges, reuse overlapping chunks during the current dataset context when safe, and require another user action for more data. Label incomplete history as partial and preserve cancellation/generation checks. Do not create one independent 64 MiB automatic load per segment. Session selection must reset charts, cursor, map and lap context even when the UK date is unchanged.

Use the existing compact dark UI and component-scoped styles. Add Event within the existing Edit workflow, with clear Save/Cancel, conflict feedback and needs-review state. Keep conditional controls/statuses in reserved or local space, preserve focus, and verify appearance/removal at desktop, 390px and 320px widths. No global CSS change is proposed. Preserve the approved Nürburgring layout and existing telemetry/track behavior.

## Backfill, validation and rollback

1. Nico reviews source rows, same-date groupings and actual range assignments. Resolve units only from evidence. Retain unmatched rows and all unrelated dates. The audit report is not a write authorization.

2. After schema/backend approval, implement the shared validator/transaction writer and an operator CLI that defaults to dry-run, consumes an explicit reviewed manifest and reports exact reads/writes/conflicts. No source discovery, sample downloading or scans hidden inside backfill. Require an explicit manifest checksum for write mode. Set its final total request/read/write budget from the reviewed manifest before any write run.

3. Test separate runs on one date, missing metadata, midnight crossing, equal timestamps, boundary chunks, reassignment, partial split/merge, stale revisions, duplicate requests, backfill reruns and changed manifests. Validate query/load budgets, sparse/empty results, cancellation and navigation. Run Greenpower unit/emulator suites, focused callable tests, desktop/mobile UI checks, build and lint after implementation.

4. Update data-model.md for the new paths/contracts and readme.md for the editor/backfill/rollback workflow; update ui-spec.md only if a shared interaction pattern changes. Keep this proposal as dated evidence, not an active schema definition.

5. Deploy only when explicitly requested, after commit/push and live index comparison. Historical metadata writes need Nico’s separate reviewed mapping approval. Deployment and a schema approval do not approve unresolved sample assignments.

6. Roll back the client release to restore the existing date selector; raw data remains compatible. Disable the new callable independently if needed. For metadata rollback, consume the exact applied manifest and audit revisions, refuse records edited afterward, and restore only the matching metadata revisions through an audited compensating operation. Do not delete raw records or audit history.

## Decisions requested

Approve the metadata schema and the specific callable/backend implementation above so implementation can proceed. Mapping approval remains separate: the 49 same-date candidates and four future rows are unconfirmed. No bulk metadata writes or deployment are included in this approval.
