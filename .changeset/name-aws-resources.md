---
"infra": patch
---

Give every AWS resource an explicit, readable name instead of relying on CloudFormation's auto-generated ones (e.g. `PetertranSiteStack-ResumeTable5083EE1E-...`), so tables, the S3 site bucket, IAM roles, the zero-trust-lab KMS key/Cognito pools, and the RUM identity pool all read clearly in the console and X-Ray trace map.
