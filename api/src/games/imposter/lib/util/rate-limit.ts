import { createRateLimiter } from "api-shared/rate-limit";
import { ddb, TABLE_NAME } from "../aws/ddb";

// Only guards the Anthropic-backed "Surprise Me" word pair generation, not
// the game's other mutations - same limit as the resume API's AI-query
// limiter since both ultimately call the same Anthropic account.
export const assertNotRateLimited = createRateLimiter({ ddb, tableName: TABLE_NAME, limitPerMinute: 5 });
