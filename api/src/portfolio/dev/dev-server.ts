import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { typeDefs } from "../schema";
import { devResolvers } from "./dev-resolvers";
import type { Context } from "../context";

const server = new ApolloServer<Context>({ typeDefs, resolvers: devResolvers });
const { url } = await startStandaloneServer(server, {
  listen: { port: 4000 },
  context: async () => {
    // Dev resolvers return hardcoded data directly and never call
    // getResumePartition, so it only needs to satisfy the type here.
    const baseContext: Context = {
      getResumePartition: async () => [],
      runInternalQuery: async (query: string) => {
        const res = await server.executeOperation({ query }, { contextValue: baseContext });
        if (res.body.kind !== "single") {
          return { data: null, errors: ["Unexpected multi-part GraphQL response."] };
        }
        const { data, errors } = res.body.singleResult;
        return {
          data: (data ?? null) as Record<string, unknown> | null,
          errors: errors?.map((e) => e.message),
        };
      },
    };
    return baseContext;
  },
});
console.log(`Dev GraphQL server (mock, no DynamoDB) ready at ${url}`);
