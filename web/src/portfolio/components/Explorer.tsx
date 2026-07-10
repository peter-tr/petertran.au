import { useMemo } from "react";
import { Link } from "react-router-dom";
import { GraphiQLProvider } from "@graphiql/react";
import { GraphiQLInterface } from "graphiql";
import { createGraphiQLFetcher } from "@graphiql/toolkit";
import type { Storage as GraphiQLStorage } from "@graphiql/toolkit";
import { explorerPlugin } from "@graphiql/plugin-explorer";
import "@graphiql/react/setup-workers/vite";
import "@graphiql/react/style.css";
import "@graphiql/plugin-doc-explorer/style.css";
import "@graphiql/plugin-history/style.css";
import "@graphiql/plugin-explorer/style.css";
import "graphiql/graphiql.css";
import { ENDPOINT } from "../lib/graphql";
import Section from "./Section";
import AskAI from "./AskAI";
import QueryRanBridge from "./QueryRanBridge";

const DEFAULT_TABS = [
  {
    query: `# Please try editing this query, or explore the other tabs above.
query WhoAmI {
  person {
    name
  }
  experience(currentOnly: true) {
    role
  }
}`,
  },
  {
    query: `# Fill in the fields below and hit Run to send a real message.
mutation ReachOut {
  sendMessage(
    input: {
      name: ""
      email: ""
      message: ""
    }
  ) {
    success
    message
  }
}`,
  },
  {
    query: `query WorkHistory {
  experience {
    company
    role
    startDate
    endDate
    highlights
  }
}`,
  },
  {
    query: `query Interests {
  interests {
    hobbies
    favoriteFoods
    favoriteShows
  }
}`,
  },
  {
    query: `query Projects {
  projects {
    name
    stack
    description
  }
}`,
  },
];

// Disabling storage means GraphiQL never persists edits, so the default
// tabs above always come back on refresh instead of a visitor's last edits.
const noStorage: GraphiQLStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
};

export default function Explorer() {
  const fetcher = useMemo(() => (ENDPOINT ? createGraphiQLFetcher({ url: ENDPOINT }) : null), []);
  const explorer = useMemo(() => explorerPlugin(), []);

  return (
    <Section id="query" typeName="Query" wide>
      <p className="project-desc" style={{ marginBottom: "1rem" }}>
        This isn't a mockup — it's the real schema, introspected live from the API backing this page. Ask in
        plain English below, use the explorer to click together a query, or write your own.
      </p>
      {fetcher ? (
        <div className="sandbox-frame">
          <GraphiQLProvider
            fetcher={fetcher}
            defaultTabs={DEFAULT_TABS}
            plugins={[explorer]}
            referencePlugin={null}
            visiblePlugin={explorer}
            storage={noStorage}
          >
            <QueryRanBridge />
            <AskAI />
            <div className="graphiql-mount">
              <GraphiQLInterface defaultEditorToolsVisibility={false} />
            </div>
          </GraphiQLProvider>
        </div>
      ) : (
        <p className="status-line">// endpoint not configured</p>
      )}
      <p className="section-hint" style={{ marginTop: "0.8rem" }}>
        Curious how this API is actually holding up?{" "}
        <Link to="/#stats">See live request counts and latency →</Link>
      </p>
    </Section>
  );
}
