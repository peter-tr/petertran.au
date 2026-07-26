---
"api": minor
"infra": minor
"web": minor
---

add saveable/applyable "profiles" to the warm-schedule settings page

Snapshots the whole 6-project provisioned-concurrency config (all
schedules/concurrency/memory at once) under a name, stored in a new SSM
parameter alongside the live config. The settings page can now save the
current setup as a profile, apply a saved one back (flipping every
project's real EventBridge schedules and reconciling PC/memory
immediately, same as an individual project save), or delete one - so
switching between modes (e.g. "all cold, 1024MB" vs "PC everywhere,
512MB") no longer means hand-editing every row.
