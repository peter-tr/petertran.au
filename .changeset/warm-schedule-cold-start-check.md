---
"api": patch
"infra": patch
---

add an on-demand "Check cold start rate" action to the warm-schedule settings page

Runs a CloudWatch Logs Insights query (`filter @type = "REPORT" | stats count(@initDuration) as coldStarts, count(*) as total`) per project over the last 24h, aggregated across all of that project's target Lambdas, and surfaces the cold-start count/percentage next to each project's existing cost line - previously there was no way to tell from the settings page whether a given PC schedule was actually working. Kept as an explicit "check now" button rather than a live/cached figure, since Logs Insights queries are async and take several seconds each; the existing scheduled+cached pattern used for cost data would be overkill for a rarely-clicked diagnostic. `warm-schedule`'s Lambda gets new `logs:StartQuery`/`logs:GetQueryResults` IAM grants scoped to each target's own log group, and its timeout is bumped 60s -> 120s to give the new action real margin.
