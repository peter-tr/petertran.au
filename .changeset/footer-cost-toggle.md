---
"web": minor
---

add a Settings toggle for the footer's real cost line

Lets a visitor hide the "real cost since launch" line in the footer - a per-browser localStorage preference, following the same pattern as the other Settings toggles (`useShowAlsoBuilt`, `usePageLoadWarmup`). When off, the `Footer` GraphQL query is skipped entirely rather than fetched and just hidden. Also notes that the AWS side of the displayed cost is within the $200 AWS Free Tier credit.
