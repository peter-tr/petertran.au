import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import * as AWSXRay from "aws-xray-sdk-core";

export interface DdbClientConfig {
  defaultTableName: string;
  xray?: boolean;
}

export interface DdbClient {
  ddb: DynamoDBDocumentClient;
  TABLE_NAME: string;
}

// X-Ray needs an active Lambda invocation to attach subsegments to -- wrapping
// the client outside Lambda (e.g. local dev) would either no-op noisily or
// throw depending on mode, so only instrument when actually running there.
export function createDdbClient({ defaultTableName, xray = false }: DdbClientConfig): DdbClient {
  const rawClient = new DynamoDBClient({});
  const client =
    xray && process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.captureAWSv3Client(rawClient) : rawClient;

  return {
    ddb: DynamoDBDocumentClient.from(client),
    TABLE_NAME: process.env.TABLE_NAME ?? defaultTableName,
  };
}
