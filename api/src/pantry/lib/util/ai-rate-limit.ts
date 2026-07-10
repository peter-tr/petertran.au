import { createRateLimiter } from "@shared/rate-limit";
import { ddb, TABLE_NAME } from "../aws/ddb";

// Separate limiter for parseCommand specifically, since it's the only pantry
// call that costs real Anthropic spend - the CRUD limiter next to this file
// stays at 20/min for plain writes. Deliberately looser than the resume
// API's/Imposter's 5/min Anthropic limiters: those are one-off asks, but a
// command bar is naturally conversational - restocking after a grocery run
// easily means 4-5 messages in a minute, and that's not abuse.
export const assertAiNotRateLimited = createRateLimiter({ ddb, tableName: TABLE_NAME, limitPerMinute: 15 });
