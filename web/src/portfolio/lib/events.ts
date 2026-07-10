// Fired on `window` whenever a GraphQL request completes in the explorer --
// lets unrelated components (like the stats dashboard) react to "a query just
// ran" without threading state through props across sibling components.
export const QUERY_RAN_EVENT = "petertran:query-ran";
