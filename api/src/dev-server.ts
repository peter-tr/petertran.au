import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { typeDefs } from "./schema.js";
import { generateQuery } from "./generate-query.js";
import { person, education, experience, projects, skills, programs, type Experience } from "./data.js";

const resolvers = {
  Query: {
    person: () => person,
    education: () => education,
    experience: (_: unknown, args: { company?: string; currentOnly?: boolean }) => {
      let items = experience;
      if (args.company) {
        const needle = args.company.toLowerCase();
        items = items.filter((e) => e.company.toLowerCase().includes(needle));
      }
      if (args.currentOnly) items = items.filter((e) => e.endDate === null);
      return items;
    },
    projects: () => projects,
    skills: (_: unknown, args: { category?: string }) => {
      let items = skills;
      if (args.category) {
        const needle = args.category.toLowerCase();
        items = items.filter((s) => s.category.toLowerCase().includes(needle));
      }
      return items;
    },
    programs: () => programs,
    generateQuery: (_: unknown, args: { prompt: string }) => generateQuery(args.prompt),
  },
  Mutation: {
    sendMessage: (_: unknown, args: { input: { name: string; email: string; message: string } }) => {
      console.log("Mock sendMessage received:", args.input);
      return { success: true };
    },
  },
  Experience: {
    isCurrent: (parent: Experience) => parent.endDate === null,
  },
};

const server = new ApolloServer({ typeDefs, resolvers });
const { url } = await startStandaloneServer(server, { listen: { port: 4000 } });
console.log(`Dev GraphQL server (mock, no DynamoDB) ready at ${url}`);
