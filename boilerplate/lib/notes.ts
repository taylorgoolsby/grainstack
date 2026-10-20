import { randomUUID } from "crypto";
import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "./dynamo";

const PK = "LIST#default"; // swap for USER#<id> when you add auth

export type Note = { pk: string; sk: string; text: string; createdAt: string };

export async function listNotes(): Promise<Note[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": PK },
      ScanIndexForward: false, // newest first
    })
  );
  return (res.Items ?? []) as Note[];
}

export async function addNote(text: string) {
  const now = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK, sk: `${now}#${randomUUID()}`, text, createdAt: now },
    })
  );
}

export async function deleteNote(sk: string) {
  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk: PK, sk } }));
}
