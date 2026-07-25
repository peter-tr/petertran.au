---
"web": patch
---

perf(design-studio): cut Gallery's initial load from 3 concurrent GraphQL requests to 1 - `Gallery.tsx`'s own `listDesigns()` and `TemplatesSection`'s unfiltered `listTemplates()` fired independently, plus a near-duplicate `listTemplates()` from the debounced search/filter effect re-firing on mount with an empty filter. That 3rd request could overflow design-studio-graphql's 2-instance provisioned concurrency and cold-start (~4.1s Init Duration), which is what made a real page load slow - confirmed via CloudWatch/X-Ray/CloudTrail against the live Lambda. Combined designs+templates into one `GALLERY_QUERY`, and `TemplatesSection` now reuses that data instead of re-requesting the same unfiltered list.
