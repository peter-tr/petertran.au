import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import { typeDefs } from "../schema";
import { devResolvers } from "./dev-resolvers";

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers: devResolvers }]),
});
const { url } = await startStandaloneServer(server, { listen: { port: 4002 } });
console.log(`Dev pantry GraphQL server (mock, no DynamoDB) ready at ${url}`);
