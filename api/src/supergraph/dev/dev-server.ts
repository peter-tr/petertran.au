import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { ApolloGateway, IntrospectAndCompose } from "@apollo/gateway";

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: [
      { name: "portfolio", url: "http://localhost:4000" },
      { name: "imposter", url: "http://localhost:4001" },
      { name: "pantry", url: "http://localhost:4002" },
      { name: "design-studio", url: "http://localhost:4004" },
    ],
    // Keeps retrying composition instead of failing hard if a subgraph dev
    // server isn't up yet - so startup order between the four `dev:*`
    // scripts doesn't matter.
    pollIntervalInMs: 5000,
  }),
});

const server = new ApolloServer({ gateway });
const { url } = await startStandaloneServer(server, { listen: { port: 4003 } });
console.log(`Supergraph gateway (portfolio + pantry + imposter + design-studio) ready at ${url}`);
