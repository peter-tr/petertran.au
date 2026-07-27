---
"infra": minor
---

`DesignStudioStack` now takes a required `supergraphUrl` prop (mirroring `SupergraphStackProps.apiBaseUrl`) and passes it into the Lambda as `SUPERGRAPH_URL`, letting design-studio's new opt-in portfolio-data-lookup tool call the real public composed supergraph endpoint. No new IAM grant - a plain outbound HTTPS call to a public endpoint, same reasoning already documented for why the Router itself needs none to reach subgraphs. The Lambda's timeout goes from 30s to 40s to cover the new tool loop's worst-case added latency (up to 2 iterations of the supergraph call plus Claude round trip) on top of the existing generation call.
