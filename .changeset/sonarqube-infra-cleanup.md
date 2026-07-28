---
"infra": patch
---

Fix a SonarCloud cognitive-complexity finding in monitoring-stack.ts: reduce `MonitoringStack`'s constructor from 28 to under 15 by extracting alarm-topic creation, per-function/per-table registration, the alerts-settings Lambda, and dashboard-row building into named helper functions (S3776). No behavior change.
