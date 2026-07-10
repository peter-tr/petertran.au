import type { Context as BaseContext } from "@shared/context";
import type { ResumeItem } from "./lib/aws/resume-data";

export interface Context extends BaseContext {
  userAgent?: string;
  functionName?: string;
  getResumePartition: () => Promise<ResumeItem[]>;
}
