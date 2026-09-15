# Firestore read/write budget — 2026-09-15

## Data ownership and triggers

- Sheets remain the attendance/reason/color source. Merely viewing or refreshing either attendance view never writes a statistical summary.
- Modern attendance calculates the visible dropout badge in memory from the already loaded Sheet and timetable. A committed status edit debounces a summary refresh. Explicit attendance/survey synchronization also refreshes the class summary. Unchanged summaries are not written.
- Legacy attendance reads the Sheet through the authenticated reader and one selected-day memo document. It does not load CheckHere or generate statistics. Only the selected version is mounted.
- Modern external-Sheet polling runs every five minutes while visible and not editing. It reads the Sheet only, not all linked Firestore data. Focus changes do not trigger extra requests. Non-retryable quota/auth errors stop that polling. Manual reload refreshes selected-day portal metadata as well.
- Satisfaction survey synchronization is explicit. The former ten-minute automatic synchronization has been removed. A transaction skips saving identical results (ignoring synchronization timestamps); the displayed last-save timestamp remains accurate.

## CheckHere latest documents

`classes/{classId}/checkhereCurrent/{YYYY-MM-DD}` contains the current records for that day. Administrator access is identical to the former snapshot source, with deletion denied. Existing immutable `checkhereSnapshots` archives and request/source audit records are retained.

The platform-save action merges records transactionally by student ID and collection time. It preserves students not present in a partial collection, refuses equal-time conflicting data, and cannot overwrite a newer collection with an older one. The server is read again before reporting a successful changed save. Repeating an identical save requires a verification read but no new write.

On the first explicit save for a day, existing archives for that day are merged once. Until then, a read of a missing current document falls back to the original day query; reads never perform a migration write. No global migration scan is run automatically. Refresh an already-open portal before using the new saver. Older portal tabs still use the archive writer and should be reloaded.

The attendance view listens to one current-day document. New saves appear without rereading the Sheet or regenerating the entire class summary. Statistics read current documents only for dates containing recognized attendance; only unmigrated dates fall back to archives. They no longer scan the whole class's historical snapshot collection.

## Operation budget (not a billing guarantee)

- Current day read: 1 document. Initial view also attaches a 1-document listener. Subsequent changes to that day deliver 1 document, independent of prior collection count.
- Repeated identical platform save: 1 server read per class/day, 0 writes.
- Changed platform save, already migrated: usually 3 document reads (precheck, transaction, verification), 1 write per class/day. Transaction retries and security-rule dependent reads are additional.
- Example: 17 classes × 40 days × 8 complete historical saves/day = 5,440 current-day writes and approximately 16,320 direct reads if every collection timestamp changes. Initial archive migration, UI reads, authorization/rules, surveys and retries are extra. Collecting only the day being worked on is much lighter.
- Statistics: metadata documents + published timetable + summary + recognized-date current documents. No CheckHere reads if there is no recognized attendance to classify. Identical concurrent sync requests coalesce within a user/browser context.

Firestore's published free quota is 50,000 document reads/day, 20,000 writes/day, 1 GiB stored, and 10 GiB outbound/month: https://firebase.google.com/docs/firestore/quotas . This change reduces repeated work; it does not restore an exhausted daily quota or guarantee free operation under arbitrary traffic. Existing archives still count toward storage, and large repeated downloads still count toward bandwidth.

## Validation

Synthetic tests cover repeat-save counts, 50 successive collections remaining one document, partial merge, empty memo changes, lost responses, stale/conflicting writes, 100 concurrent summary requests coalescing, recognized-date-only reads, and unchanged survey results skipping writes. Browser tests cover Sheet edits/recommendations, selected-version isolation, pending-request recovery, and quota errors. Production data reads may remain blocked until the already-exhausted daily quota resets.
