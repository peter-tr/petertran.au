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
  isCurrent: boolean;
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

export interface Personal {
  hobbies: string[];
  favoriteFoods: string[];
}

export interface ResumeData {
  person: Person;
  personal: Personal;
  education: Education[];
  experience: Experience[];
  projects: Project[];
  skills: SkillCategory[];
  programs: Program[];
}
