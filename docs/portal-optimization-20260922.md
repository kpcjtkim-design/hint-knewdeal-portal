# Portal efficiency and CheckHere memo defaults — 2026-09-22

## Reads and lifecycle

- One memory-only, 60-second read cache per database and exact signed-in User object shares saved attendance summaries, timetable documents, survey summaries/settings and material links across views. Concurrent equal reads coalesce. Cached values are cloned and retention is bounded; nothing is persisted to browser storage.
- Explicit refresh and manual synchronization request fresh data. Writes invalidate relevant entries before/after mutation, including uncertain failure. Sign-out/account changes clear the session; invalidated in-flight reads cannot repopulate it. RAW reads remain fresh.
- Detached/replaced pages stop starting subsequent class reads. Late imported or mounted pages are disposed without overwriting the active page cleanup. Only the selected attendance version remains mounted.
- Survey Sheets reads no longer page through allocated empty rows: one bounded selected-column batch read for summaries, one bounded rectangle for RAW. Existing 20,000-row / 300-column RAW bounds remain. Internal empty gaps, zero scores and original row numbers are preserved.
- Each explicit multi-class sync shares its response sources for that operation. A new operation starts fresh. Scheduled workers share response sources only within the existing bounded execution slot. Google pacing and quota backoff remain.
- Legacy attendance manual reload bypasses the reader cache, like modern attendance. Non-retryable malformed upstream responses remain non-retryable.

Synthetic measurements: 20,000 allocated rows with two responses and a 15,000-row internal gap required 22→3 Google requests for summaries and 41→2 for RAW. These are fixture measurements, not a promise about production latency or free quotas.

## Collector

- Keep discovered class navigation URLs in process memory; avoid redundant navigation immediately after discovering a day. Explicit readback still reloads the actual page.
- Verify the target row identity before every modal click without serializing the whole roster each time; fall back to the full identity scan when the row moves. Read the editor values together.
- For an approved changed memo, when its corresponding timestamp is missing, use existing RULES.start / RULES.end (currently 09:00 / 18:00). Preserve actual existing timestamps, including one appearing between review and input. Do not fill the opposite, untouched side or create timestamps when the memo already matches.
- Approval previews display automatic times. The server independently derives permitted defaults; approval schema and approver identity do not change. Older collectors cannot approve a new fallback until restarted.
- Verify both time and memo by independently reopening the saved record; only then persist the actual current record to the portal. Report automatic timestamps in existing job results. Preserve request, job and snapshot history.

No permission/schema migration, source Sheet edits, student test records or live CheckHere writes are part of validation. Local runtime build: 20260922.1.
