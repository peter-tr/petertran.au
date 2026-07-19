import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { captureAwsClient } from "./xray";

export interface DdbClientConfig {
  defaultTableName: string;
  xray?: boolean;
}

export interface DdbClient {
  ddb: DynamoDBDocumentClient;
  TABLE_NAME: string;
}

export function createDdbClient({ defaultTableName, xray = false }: DdbClientConfig): DdbClient {
  const rawClient = new DynamoDBClient({});
  const client = xray ? captureAwsClient(rawClient) : rawClient;

  return {
    ddb: DynamoDBDocumentClient.from(client),
    TABLE_NAME: process.env.TABLE_NAME ?? defaultTableName,
  };
}
