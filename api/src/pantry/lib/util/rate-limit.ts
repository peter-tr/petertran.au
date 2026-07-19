import { createRateLimiter } from "api-shared/rate-limit";
import { ddb, TABLE_NAME } from "../aws/ddb";

// Higher than the resume API's AI-query limiter since these are plain CRUD
// writes, not Anthropic calls - tightened separately once AI-backed mutations
// land.
export const assertNotRateLimited = createRateLimiter({ ddb, tableName: TABLE_NAME, limitPerMinute: 20 });
