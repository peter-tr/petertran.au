import {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

export interface DynamoRepositoryConfig {
  ddb: DynamoDBDocumentClient;
  tableName: string;
  pk: string;
  skPrefix: string;
  itemType: string;
}

// Shared get/getAll/put/delete shape for pantry's two collection-style
// stores (inventory, shopping list) - both live under the same pk with a
// prefixed sk, and both need a per-item defaults backfill on read (see
// CLAUDE.md's non-nullable-field-on-persisted-data guidance). Scoped to
// these two only: settings.ts/price-sync-status.ts are singleton stores
// with no id/prefix, so they don't fit this shape.
export abstract class DynamoRepository<T extends { id: string }> {
  constructor(private readonly config: DynamoRepositoryConfig) {}

  protected abstract applyDefaults(item: T): T;

  private key(id: string) {
    return { pk: this.config.pk, sk: `${this.config.skPrefix}${id}` };
  }

  async get(id: string): Promise<T | null> {
    const res = await this.config.ddb.send(
      new GetCommand({ TableName: this.config.tableName, Key: this.key(id) })
    );
    const item = res.Item?.data as T | undefined;

    return item ? this.applyDefaults(item) : null;
  }

  async getAll(): Promise<T[]> {
    const res = await this.config.ddb.send(
      new QueryCommand({
        TableName: this.config.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": this.config.pk, ":prefix": this.config.skPrefix },
      })
    );

    return (res.Items ?? []).map((i) => this.applyDefaults(i.data as T));
  }

  async put(item: T): Promise<void> {
    await this.config.ddb.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: { ...this.key(item.id), type: this.config.itemType, data: item },
      })
    );
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.config.ddb.send(
      new DeleteCommand({
        TableName: this.config.tableName,
        Key: this.key(id),
        ReturnValues: "ALL_OLD",
      })
    );

    return res.Attributes !== undefined;
  }
}
