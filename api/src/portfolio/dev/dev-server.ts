import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { typeDefs } from "../schema";
import { devResolvers } from "./dev-resolvers";

const server = new ApolloServer({ typeDefs, resolvers: devResolvers });
const { url } = await startStandaloneServer(server, { listen: { port: 4000 } });
console.log(`Dev GraphQL server (mock, no DynamoDB) ready at ${url}`);
