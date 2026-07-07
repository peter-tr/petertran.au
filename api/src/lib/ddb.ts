import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import * as AWSXRay from "aws-xray-sdk-core";

// X-Ray needs an active Lambda invocation to attach subsegments to -- wrapping
// the client outside Lambda (e.g. local dev) would either no-op noisily or
// throw depending on mode, so only instrument when actually running there.
const rawClient = new DynamoDBClient({});
const client = process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.captureAWSv3Client(rawClient) : rawClient;

export const ddb = DynamoDBDocumentClient.from(client);

export const TABLE_NAME = process.env.TABLE_NAME ?? "petertran-au-resume";
export const PK = "RESUME";
