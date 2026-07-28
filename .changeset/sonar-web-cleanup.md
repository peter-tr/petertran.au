---
"web": patch
---

Resolve the SonarCloud findings across the web workspace (outside pantry): swap pseudo-interactive `<div>`/`<h1>`/`<li>` click targets for real buttons and ARIA `role="group"`/`role="img"` for `<fieldset>`/SVG `<title>`, mark every component's props `Readonly<...>`, extract nested ternaries and a nested template literal, give mapped lists stable keys, make `useState` pairs symmetric, and simplify `GraphQLCode`'s token regex plus the cognitive complexity of `formatQuery` and the imposter setup form. No user-facing behaviour change.
