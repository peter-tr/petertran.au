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
  skPrefix: string;
  itemType: string;
}

// Shared get/getAll/put/delete shape for pantry's two collection-style
// stores (inventory, shopping list) - both live under a per-user pk with a
// prefixed sk, and both need a per-item defaults backfill on read (see
// CLAUDE.md's non-nullable-field-on-persisted-data guidance). Scoped to
// these two only: settings.ts/price-sync-status.ts are singleton stores
// with no id/prefix, so they don't fit this shape.
//
// `pk` is a parameter on every method, not part of the config - it's a
// per-request value (which pantry the caller is signed into, see
// context.ts's pkForUser), not something fixed at construction time, so
// this repository stays a stateless module-level singleton.
export abstract class DynamoRepository<T extends { id: string }> {
  constructor(private readonly config: DynamoRepositoryConfig) {}

  protected abstract applyDefaults(item: T): T;

  private key(pk: string, id: string) {
    return { pk, sk: `${this.config.skPrefix}${id}` };
  }

  async get(pk: string, id: string): Promise<T | null> {
    const res = await this.config.ddb.send(
      new GetCommand({ TableName: this.config.tableName, Key: this.key(pk, id) })
    );
    const item = res.Item?.data as T | undefined;

    return item ? this.applyDefaults(item) : null;
  }

  async getAll(pk: string): Promise<T[]> {
    const res = await this.config.ddb.send(
      new QueryCommand({
        TableName: this.config.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": pk, ":prefix": this.config.skPrefix },
      })
    );

    return (res.Items ?? []).map((i) => this.applyDefaults(i.data as T));
  }

  async put(pk: string, item: T): Promise<void> {
    await this.config.ddb.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: { ...this.key(pk, item.id), type: this.config.itemType, data: item },
      })
    );
  }

  async delete(pk: string, id: string): Promise<boolean> {
    const res = await this.config.ddb.send(
      new DeleteCommand({
        TableName: this.config.tableName,
        Key: this.key(pk, id),
        ReturnValues: "ALL_OLD",
      })
    );

    return res.Attributes !== undefined;
  }
}
