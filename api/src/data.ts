// Source of truth for resume content. Mirrors resume.tex.
// Edit here, then run `npm run seed --workspace=api` to push to DynamoDB.

export interface Link {
  label: string;
  url: string;
}

export interface Person {
  name: string;
  email: string;
  location: string;
  clearance: string;
  links: Link[];
}

export interface Interests {
  hobbies: string[];
  favoriteFoods: string[];
  favoriteShows: string[];
}

export interface Education {
  institution: string;
  degree: string;
  location: string;
  startDate: string;
  endDate: string;
  honors: string;
}

export interface Experience {
  company: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string | null;
  summary: string | null;
  highlights: string[];
}

export interface Project {
  name: string;
  stack: string[];
  description: string;
  url: string | null;
}

export interface SkillCategory {
  category: string;
  items: string[];
}

export interface Program {
  name: string;
  organization: string;
  description: string;
  startDate: string;
  endDate: string;
}

export const person: Person = {
  name: "Peter Tran",
  email: "peter2002tran@outlook.com",
  location: "Sydney, Australia",
  clearance: "Negative Vetting 1 (Australian Security Clearance)",
  links: [
    { label: "LinkedIn", url: "https://linkedin.com/in/peter-k-tran" },
    { label: "GitHub", url: "https://github.com/peter-tr" },
  ],
};

export const interests: Interests = {
  hobbies: ["Bouldering", "Badminton", "Mahjong", "Poker", "Catan", "Fashion", "Hiking", "Running", "Gym"],
  favoriteFoods: ["Sushi", "Matcha", "Coffee", "Pizza"],
  favoriteShows: ["Suits", "Stranger Things", "Severance", "Breaking Bad"],
};

export const education: Education[] = [
  {
    institution: "University of Queensland",
    degree: "Bachelor of Engineering (Honours) & Master of Engineering (Software)",
    location: "Brisbane, Australia",
    startDate: "2020-02",
    endDate: "2024-12",
    honors: "First Class Honours - GPA: 6.35/7",
  },
];

export const experience: Experience[] = [
  {
    company: "Commonwealth Bank of Australia",
    role: "Backend Software Engineer",
    location: "Sydney, Australia",
    startDate: "2026-02",
    endDate: null,
    summary:
      "NetBank Next - rebuilding the backend of CommBank's online banking (17M+ customers, 170 TPS) onto a federated GraphQL API - one of the bank's first large-scale GraphQL federation deployments",
    highlights: [
      "Drove architectural decisions for the GraphQL federation platform - supergraph composition, schema governance, observability, subgraph CI/CD - and implemented its core infrastructure, enabling 10+ service domains to independently build and deploy subgraphs",
      "Built and own three GraphQL subgraphs (Accounts, Transactions, Parties), migrating legacy REST/SOAP endpoints onto the federated layer and cutting p95 latency from 500ms to 300ms (40%)",
      "Designed a custom GraphQL directive enforcing OAuth 2.0 scope-based authorization, giving field- and entity-level access control over sensitive financial data",
      "Built an MCP server exposing the supergraph to AI agents, used by 200+ engineers to query the schema and customer usage in natural language instead of hand-writing GraphQL introspection",
      "Serve as on-call engineer (PagerDuty) for the GraphQL platform serving 17M customers, operating against a 99.9% availability SLO",
    ],
  },
  {
    company: "Commonwealth Bank of Australia",
    role: "Graduate Software Engineer",
    location: "Sydney, Australia",
    startDate: "2025-02",
    endDate: "2026-02",
    summary: null,
    highlights: [
      "Built event-driven ingestion and storage pipelines (SQS -> Lambda -> S3/PostgreSQL -> Kafka) within CommBank's Payment Data Platform, normalizing 5,000 payment events/sec into ISO 20022 as a common cross-bank, cross-country standard",
      "Joined NetBank Next at inception (Sep 2025), built its first subgraphs - promoted to the platform team",
    ],
  },
  {
    company: "Boeing Australia",
    role: "Graduate Software Engineer",
    location: "Brisbane, Australia",
    startDate: "2024-11",
    endDate: "2025-02",
    summary:
      "Safety-critical, distributed embedded systems engineering on the MQ-28 Ghost Bat, Boeing's autonomous fighter aircraft",
    highlights: [
      "Built sensor data ingestion software for the MQ-28 mission computer on Green Hills INTEGRITY RTOS, meeting DO-178C safety-critical certification standards",
      "Developed C++ scenario-based testing frameworks and hardware-in-the-loop (HWIL) infrastructure (Python, MATLAB), verifying mission computer software against real avionics hardware",
      "Built a custom internal React dashboard for monitoring health and gathering metrics from air-gapped physical components and servers in the aircraft's digital twin, cutting hardware fault diagnosis time from 2 hours to 2 minutes",
      "Completed a master's thesis with Boeing evaluating Rust as a certifiable replacement for C++ and Ada in DO-178C safety-critical aviation software",
    ],
  },
  {
    company: "Boeing Australia",
    role: "Undergraduate Software Engineer",
    location: "Brisbane, Australia",
    startDate: "2021-11",
    endDate: "2024-11",
    summary: null,
    highlights: [],
  },
  {
    company: "Services Australia",
    role: "Software Engineering Intern",
    location: "Brisbane, Australia",
    startDate: "2022-02",
    endDate: "2023-11",
    summary: null,
    highlights: [
      "Optimised the myGov Inbox, a React-based messaging feature serving millions of citizens across myGov, Centrelink, and Medicare, improving page load times by 30%",
    ],
  },
];

export const projects: Project[] = [
  {
    name: "petertran.au - this site",
    stack: [
      "TypeScript",
      "React",
      "GraphQL (Apollo Server)",
      "AWS CDK",
      "Lambda",
      "DynamoDB",
      "CloudFront",
      "Claude API",
      "GitHub Actions",
    ],
    description:
      "This portfolio is the project: a publicly queryable GraphQL API (this very schema) backing a React front end, deployed entirely on AWS via CDK - Lambda, DynamoDB, CloudFront, Secrets Manager - with GitHub Actions CI/CD over OIDC. Includes a live GraphiQL explorer, a Claude Haiku-powered natural-language query generator, and this systemStats query pulling real CloudWatch metrics.",
    url: "https://github.com/peter-tr/petertran.au",
  },
  {
    name: "Retrieval-Augmented Generation Pipeline",
    stack: ["Python", "PyTorch", "Machine Learning"],
    description:
      "Built a RAG pipeline with Hugging Face Transformers and FAISS, benchmarking BM25, DPR, and TILDEv2 retrieval; TILDEv2 outperformed BM25 (nDCG@3: 0.77 vs. 0.48, +61%) with statistical significance.",
    url: null,
  },
];

export const skills: SkillCategory[] = [
  { category: "Languages", items: ["TypeScript", "Java", "Python", "C/C++", "Rust"] },
  {
    category: "Frameworks & APIs",
    items: ["GraphQL (Apollo Federation)", "Spring Boot", "React", "Next.js", "Node.js", "OAuth 2.0"],
  },
  {
    category: "Infrastructure & Tools",
    items: ["AWS", "DynamoDB", "PostgreSQL", "Kafka", "Docker", "GitHub Actions", "Grafana"],
  },
  { category: "Certifications", items: ["AWS Certified Developer - Associate"] },
];

export const programs: Program[] = [
  {
    name: "Australian Defence Force Cyber GAP Program",
    organization: "Australian Defence Force",
    description:
      "Selected for a competitive 12-month ADF cybersecurity development program; completed hands-on training in digital forensics, threat and risk assessment, and cybersecurity fundamentals",
    startDate: "2022-01",
    endDate: "2022-12",
  },
];
