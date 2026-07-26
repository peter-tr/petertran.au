---
"web": patch
---

replace per-project warm-schedule Save buttons with a single "Save all" button and a total cost line

Lifts each project's draft schedule out of `WarmScheduleProject` (now a
controlled component) and into `PortfolioSettingsPage`, so one "Save all"
button at the bottom of the section can POST every dirty project's
schedule at once via `useWarmSchedule`'s new `saveAll`, instead of each
row round-tripping its own save. Also adds a total estimated monthly
cost line, summing every project's `scheduledMonthlyCostUsd`.
