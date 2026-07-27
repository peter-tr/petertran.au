import { parse, Kind, type OperationDefinitionNode, type SelectionSetNode } from "graphql";

// The only root Query fields a supergraph-bound tool call may select -
// deliberately excludes `meta` (generateQuery/systemStats/traceBreakdown/
// cost figures are operational/AI-internal, not for a design-generation AI
// to touch) and every pantry/imposter/design-studio field (simply absent
// from this list, no special-casing needed). Named constant since it's
// referenced from both validatePortfolioQuery below and its test file.
export const ALLOWED_PORTFOLIO_QUERY_FIELDS = [
  "person",
  "education",
  "experience",
  "projects",
  "skills",
  "programs",
  "interests",
] as const;

export interface PortfolioQueryValidation {
  ok: boolean;
  reason?: string;
}

function validateSelectionSet(selectionSet: SelectionSetNode): PortfolioQueryValidation {
  for (const selection of selectionSet.selections) {
    // Fragment spreads/inline fragments at the root could smuggle in a
    // disallowed field indirectly - rejected rather than recursed into,
    // since nothing legitimate needs a fragment at the root (every
    // portfolio field is directly selectable).
    if (selection.kind !== Kind.FIELD) {
      return { ok: false, reason: "Fragments are not allowed at the root selection set." };
    }

    const fieldName = selection.name.value;
    // Federation's auto-injected introspection field, present on every
    // subgraph regardless of whether it defines any @key entities -
    // portfolio has none (no @key/@shareable/@external/@provides/@requires
    // anywhere in its schema), so _entities never applies here, only
    // _service. Called out explicitly so the rejection reason names it,
    // rather than folding it into "not in the allowlist" below.
    if (fieldName === "_service") {
      return { ok: false, reason: "The _service introspection field is not allowed." };
    }
    if (!(ALLOWED_PORTFOLIO_QUERY_FIELDS as readonly string[]).includes(fieldName)) {
      return {
        ok: false,
        reason: `Field "${fieldName}" is not in the portfolio-only allowlist (${ALLOWED_PORTFOLIO_QUERY_FIELDS.join(", ")}).`,
      };
    }
  }

  return { ok: true };
}

// Design-studio has no local portfolio schema to execute against (unlike
// portfolio's own generate-query.ts, which gets its scoping "for free" by
// running the query against its own narrower in-process schema built only
// from portfolio's own typeDefs). This instead parses the query document by
// hand and walks its root SelectionSet, rejecting anything that isn't a
// `query` operation selecting only ALLOWED_PORTFOLIO_QUERY_FIELDS at the
// root. It does NOT validate nested selections/arguments against
// portfolio's actual schema - that's the supergraph's own job once the
// query is actually sent; this only enforces the read-only,
// portfolio-subgraph-only boundary before anything leaves this Lambda.
export function validatePortfolioQuery(query: string): PortfolioQueryValidation {
  let document;
  try {
    document = parse(query);
  } catch (err) {
    return { ok: false, reason: `Not valid GraphQL: ${err instanceof Error ? err.message : "parse error"}` };
  }

  const operations = document.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION
  );

  if (operations.length !== 1) {
    return { ok: false, reason: "Query must contain exactly one operation." };
  }

  const [operation] = operations;
  if (operation.operation !== "query") {
    return { ok: false, reason: `Only "query" operations are allowed, got "${operation.operation}".` };
  }

  return validateSelectionSet(operation.selectionSet);
}
