---
"infra": patch
---

fix: grant lambda:GetAlias so warm-schedule's alias self-heal (#232) can actually run - every reconcile tick for every project was silently failing with AccessDeniedException before this
