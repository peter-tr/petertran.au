import { createRateLimiter } from "api-shared/rate-limit";
import { ddb, TABLE_NAME } from "../aws/ddb";

// Stricter than pantry's/imposter's CRUD limiters since these calls cost real
// Anthropic API spend.
export const assertNotRateLimited = createRateLimiter({ ddb, tableName: TABLE_NAME, limitPerMinute: 5 });
