import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Status } from "./stages";

export interface User {
  username: string;
  email: string;
  passwordHash: string;
  status: Status;
  step: number;
  error: string;
  endpoints?: { dev: string; prod: string };
  createdAt: string;
  updatedAt: string;
}

export type UserPatch = Partial<Pick<User, "status" | "step" | "error" | "endpoints">>;

export interface Store {
  createUser(user: User): Promise<"ok" | "username_taken" | "email_taken">;
  getUser(username: string): Promise<User | undefined>;
  updateUser(username: string, patch: UserPatch): Promise<void>;
}

// ---------------------------------------------------------------- in-memory (GRAINSTACK_MOCK=1)
class MemoryStore implements Store {
  users = new Map<string, User>();
  emails = new Set<string>();
  async createUser(user: User) {
    if (this.users.has(user.username)) return "username_taken" as const;
    if (this.emails.has(user.email)) return "email_taken" as const;
    this.users.set(user.username, { ...user });
    this.emails.add(user.email);
    return "ok" as const;
  }
  async getUser(username: string) {
    const u = this.users.get(username);
    return u && { ...u };
  }
  async updateUser(username: string, patch: UserPatch) {
    const u = this.users.get(username);
    if (u) this.users.set(username, { ...u, ...patch, updatedAt: new Date().toISOString() });
  }
}

// ---------------------------------------------------------------- DynamoDB
// One table, partition key "pk" (string) only:
//   USER#<username>  the account
//   EMAIL#<email>    a lock item so each email can be used once
class DynamoStore implements Store {
  private doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  private table = process.env.USERS_TABLE ?? "grainstack-users";

  async createUser(user: User) {
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: this.table, Item: { pk: `USER#${user.username}`, ...user }, ConditionExpression: "attribute_not_exists(pk)" } },
            { Put: { TableName: this.table, Item: { pk: `EMAIL#${user.email}`, username: user.username }, ConditionExpression: "attribute_not_exists(pk)" } },
          ],
        }),
      );
      return "ok" as const;
    } catch (e) {
      const err = e as { name?: string; CancellationReasons?: { Code?: string }[] };
      if (err.name === "TransactionCanceledException") {
        const [userReason, emailReason] = err.CancellationReasons ?? [];
        if (userReason?.Code === "ConditionalCheckFailed") return "username_taken" as const;
        if (emailReason?.Code === "ConditionalCheckFailed") return "email_taken" as const;
      }
      throw e;
    }
  }

  async getUser(username: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk: `USER#${username}` } }));
    if (!r.Item) return undefined;
    const { pk: _pk, ...user } = r.Item;
    return user as User;
  }

  async updateUser(username: string, patch: UserPatch) {
    const fields: Record<string, unknown> = { ...patch, updatedAt: new Date().toISOString() };
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: `USER#${username}` },
        ConditionExpression: "attribute_exists(pk)",
        UpdateExpression: "SET " + keys.map((k, i) => `#k${i} = :v${i}`).join(", "),
        ExpressionAttributeNames: Object.fromEntries(keys.map((k, i) => [`#k${i}`, k])),
        ExpressionAttributeValues: Object.fromEntries(keys.map((k, i) => [`:v${i}`, fields[k]])),
      }),
    );
  }
}

// Pin to globalThis so the in-memory store and clients survive dev-server module reloads.
const g = globalThis as unknown as { __gsStore?: Store };
export function getStore(): Store {
  g.__gsStore ??= process.env.GRAINSTACK_MOCK === "1" ? new MemoryStore() : new DynamoStore();
  return g.__gsStore;
}
