import type { Context as BaseContext } from "@shared/context";

export interface Context extends BaseContext {
  userAgent?: string;
  functionName?: string;
}
