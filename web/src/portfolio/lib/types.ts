import type { ResumeQuery } from "./graphql.generated";

export type ResumeData = ResumeQuery;

export type Person = ResumeQuery["person"];
export type Link = ResumeQuery["person"]["links"][number];
export type Education = ResumeQuery["education"][number];
export type Experience = ResumeQuery["experience"][number];
export type Project = ResumeQuery["projects"][number];
export type SkillCategory = ResumeQuery["skills"][number];
export type Program = ResumeQuery["programs"][number];
export type Interests = ResumeQuery["interests"];
