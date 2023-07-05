# DynamoDB Adapter for Lucia

Database Adapter for DynamoDB.

The adapter uses aws-sdk v3.

## Installation

`pnpm install lucia-adapter-dynamodb`
OR
`yarn add lucia-adapter-dynamodb`
OR
`npm install lucia-adapter-dynamodb`

## Usage

It requires two parameters:

- a document client (used to configure the connection to dynamodb, set credentials/region etc.)
- a table name

For the document client, be sure to pass a reference to a `DynamoDBDocument` from `@aws-sdk/lib-dynamodb`, NOT a `DynamoDBClient` from `@aws-sdk/client-dynamodb` (`DynamoDBDocument` is an abstraction which handles automatic marshalling/unmarshalling of data in to JSON format).

```typescript
import { adapter } from "lucia-adapter-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region, credentials });
const document = DynamoDBDocument.from(client);

export const auth = lucia({
  adapter: adapter({ document, table: "MyAuthTable" }),
});
```

### DynamoDB Table schema

This adapter requires a Table with:

- a composite primary key consisting of a `pk` and `sk` field
- a global secondary index with the name `gsi1`
- GSI primary key with the fields `gsi1pk` and `gsi1sk`

You can use the adapter with an existing table if this matches your schema. If not, it is recommended (for now) to use a new Table dedicated for Lucia auth.

N.B. In the future, I may add a configuration option to choose the pk/sk/gsi attribute names.

#### Example DynamoDB Table

Here is an example of a Table defined using SST:

```typescript
const authTable = new Table(stack, "MyAuthTable", {
  fields: {
    pk: "string",
    sk: "string",
    gsi1pk: "string",
    gsi1sk: "string",
  },
  primaryIndex: { partitionKey: "pk", sortKey: "sk" },
  globalIndexes: {
    gsi1: { partitionKey: "gsi1pk", sortKey: "gsi1sk" },
  },
});
```
