import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import { typeDefs } from "../schema";
import { devResolvers } from "./dev-resolvers";

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers: devResolvers }]),
});
const { url } = await startStandaloneServer(server, { listen: { port: 4004 } });
console.log(`Dev Design Studio GraphQL server (mock, no MongoDB) ready at ${url}`);
