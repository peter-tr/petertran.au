---
"api": patch
"web": patch
---

auto-run the warm-schedule settings page's cold start check, and make its lookback window configurable

The check across all 6 projects completes in a few seconds, so it now runs automatically (on page load and whenever the lookback window changes) instead of needing an explicit button click. The lookback window is now a picker (10 min / 1 hour / 24 hours) instead of a fixed 24h, via a new `windowMinutes` parameter on `warm-schedule`'s `checkColdStarts` action (validated against the same curated set on both sides, same "seeded in two places" convention as `MAX_CONCURRENCY`/`MEMORY_OPTIONS_MB`). No infra changes - this reuses the IAM grants and timeout bump already shipped in the initial cold-start-check PR.
