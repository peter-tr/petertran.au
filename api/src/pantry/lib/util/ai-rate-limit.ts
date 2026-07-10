import { createRateLimiter } from "@shared/rate-limit";
import { ddb, TABLE_NAME } from "../aws/ddb";

// Separate, stricter limiter for parseCommand specifically - matches the
// resume API's and Imposter's Anthropic-backed limiters, since this is the
// only pantry call that costs real Anthropic spend. The CRUD limiter next to
// this file stays at 20/min for plain writes.
export const assertAiNotRateLimited = createRateLimiter({ ddb, tableName: TABLE_NAME, limitPerMinute: 5 });
