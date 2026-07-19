import type { Context as BaseContext } from "api-shared/context";
import type { ResumeItem } from "./lib/aws/resume-data";

export interface InternalQueryResult {
  data: Record<string, unknown> | null;
  errors?: string[];
}

export interface Context extends BaseContext {
  userAgent?: string;
  functionName?: string;
  getResumePartition: () => Promise<ResumeItem[]>;
  // Runs a query string against this same schema/resolvers, reusing this
  // request's context (so e.g. getResumePartition's memoized DynamoDB fetch
  // is shared). Lets a resolver (generateQuery) execute a query it just
  // generated server-side, without a real HTTP round trip to itself.
  runInternalQuery: (query: string) => Promise<InternalQueryResult>;
}
