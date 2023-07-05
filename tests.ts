import { testAdapter } from "@lucia-auth/adapter-test";
import { adapter as dynamoAdapter } from "./adapter";
import { LuciaError } from "lucia";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
  endpoint: "http://127.0.0.1:8000",
  credentials: {
    accessKeyId: "local",
    secretAccessKey: "local",
  },
});
const documentClient = DynamoDBDocument.from(client);

const adapter = dynamoAdapter({ documentClient, table: "Test" })(LuciaError);

/*
testAdapter(adapter, {
	user: {},
	session: {},
	key: {},
});
*/
