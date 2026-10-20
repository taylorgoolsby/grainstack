import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// On Lambda, region and credentials come from the function's execution role.
// Locally, they come from AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env.local.
const client = new DynamoDBClient({});

export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// dev table locally and on your dev function, prod table on your prod function
export const TABLE_NAME = process.env.TABLE_NAME!;
