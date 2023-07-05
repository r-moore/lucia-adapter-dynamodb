import type { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import {
  Adapter,
  InitializeAdapter,
  KeySchema,
  SessionSchema,
  UserSchema,
  LuciaError,
} from "lucia";
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

type AdapterOptions = {
  /** The DynamoDBDocument Client from @aws-sdk/lib-dynamodb, used to connect to DynamoDB */
  documentClient: DynamoDBDocument;
  /** The DynamoDB TableName to use for storing session and user records */
  table: string;
};

export const adapter = ({
  documentClient,
  table,
}: AdapterOptions): InitializeAdapter<Adapter> => {
  const TableName = table;

  const logError = (e: any, context: string) => {
    console.warn("⚠️ lucia error:", {
      context,
      message: e?.message,
      table: TableName,
    });
  };

  const getSession = async (
    sessionId: string
  ): Promise<SessionSchema | null> => {
    const cmd = new GetCommand({
      TableName,
      Key: {
        pk: "SESSION",
        sk: `SESSION#${sessionId}`,
      },
      ProjectionExpression: "id, active_expires, idle_expires, user_id",
    });

    try {
      const res = await documentClient.send(cmd);
      return res?.Item || null;
    } catch (e: any) {
      logError(e, "getSession");
      return null;
    }
  };

  const getSessionsByUserId = async (
    userId: string
  ): Promise<SessionSchema[]> => {
    const cmd = new QueryCommand({
      TableName,
      IndexName: "gsi1",
      KeyConditionExpression:
        "gsi1pk = :pk and begins_with(gsi1sk, :sk_prefix)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":sk_prefix": "SESSION#",
      },
      ProjectionExpression: "id, active_expires, idle_expires, user_id",
    });

    try {
      const res = await documentClient.send(cmd);
      return res?.Items || [];
    } catch (e: any) {
      logError(e, "getSessionsByUserId");
      return [];
    }
  };

  const setSession = async (session: SessionSchema): Promise<void> => {
    const { id, active_expires, idle_expires, user_id } = session;
    const cmd = new PutCommand({
      TableName,
      Item: {
        pk: "SESSION",
        sk: `SESSION#${id}`,
        gsi1pk: `USER#${user_id}`,
        gsi1sk: `SESSION#${id}`,
        type: "session",
        id,
        active_expires,
        idle_expires,
        user_id,
      },
      ConditionExpression: "user_id <> :user_id",
      ExpressionAttributeValues: {
        ":user_id": user_id,
      },
    });

    try {
      await documentClient.send(cmd);
    } catch (e: any) {
      if (e?.code === "ConditionalCheckFailedException") {
        throw new LuciaError("AUTH_INVALID_USER_ID");
      } else {
        logError(e, "setSession");
        throw new LuciaError("UNKNOWN_ERROR");
      }
    }
  };

  const updateSession = async (
    sessionId: string,
    partialSession: Partial<SessionSchema>
  ): Promise<void> => {
    const { active_expires, idle_expires } = partialSession;
    const cmd = new UpdateCommand({
      TableName,
      Key: {
        pk: "SESSION",
        sk: `SESSION#${sessionId}`,
      },
      AttributeUpdates: {
        active_expires: { Value: active_expires },
        idle_expires: { Value: idle_expires },
      },
    });

    try {
      await documentClient.send(cmd);
    } catch (e: any) {
      logError(e, "updateSession");
      throw new LuciaError("UNKNOWN_ERROR");
      // if (e?.code == "ResourceNotFoundException") {
      // 	throw new LuciaError("AUTH_INVALID_SESSION_ID");
      // }
    }
  };

  const deleteSession = async (sessionId: string): Promise<void> => {
    const cmd = new DeleteCommand({
      TableName,
      Key: {
        pk: "SESSION",
        sk: `SESSION#${sessionId}`,
      },
    });

    try {
      await documentClient.send(cmd);
    } catch (e: any) {
      logError(e, "deleteSession");
      throw new LuciaError("UNKNOWN_ERROR");
    }
  };

  const deleteSessionsByUserId = async (userId: string): Promise<void> => {
    const sessions = await getSessionsByUserId(userId);
    if (sessions.length > 0) {
      const cmd = new BatchWriteCommand({
        RequestItems: {
          TableName: sessions.map(({ id }) => ({
            DeleteRequest: { Key: { pk: "SESSION", sk: `SESSION#${id}` } },
          })),
        },
      });
      try {
        await documentClient.send(cmd);
      } catch (e: any) {
        console.warn("Lucia deleteSessionsByUserId()", e?.message);
      }
    }
  };

  const getUser = async (userId: string): Promise<UserSchema | null> => {
    const cmd = new GetCommand({
      TableName,
      Key: {
        pk: `USER`,
        sk: `USER#${userId}`,
      },
      ProjectionExpression: "id, attributes",
    });

    try {
      const res = await documentClient.send(cmd);
      return res?.Item || null;
    } catch (e: any) {
      logError(e, "deleteSessionsByUserId");
      return null;
    }
  };

  const setUser = async (
    user: UserSchema,
    key: KeySchema | null
  ): Promise<void> => {
    const { id, ...attributes } = user;

    if (!id) return;

    const TransactItems: TransactWriteCommandInput["TransactItems"] = [
      {
        Put: {
          TableName,
          Item: {
            pk: `USER`,
            sk: `USER#${id}`,
            type: "user",
            id,
            attributes,
          },
        },
      },
    ];

    if (key?.id) {
      TransactItems.push({
        Put: {
          TableName,
          Item: {
            pk: "KEY",
            sk: `KEY#${key.id}`,
            type: "key",
            gsi1pk: `USER#${id}`,
            gsi1sk: `KEY#${key.id}`,
            id: key.id,
            hashed_password: key.hashed_password,
            user_id: key.user_id,
          },
          ConditionExpression: "pk <> :pk",
          ExpressionAttributeValues: {
            ":pk": `KEY#${key.id}`,
          },
        },
      });
    }

    const cmd = new TransactWriteCommand({ TransactItems });

    try {
      await documentClient.send(cmd);
    } catch (e: any) {
      if (e?.code === "ConditionalCheckFailedException") {
        throw new LuciaError("AUTH_DUPLICATE_KEY_ID");
      } else {
        logError(e, "setUser");
        throw new LuciaError("UNKNOWN_ERROR");
      }
    }
  };

  const updateUser = async (
    userId: string,
    partialUser: Partial<UserSchema>
  ): Promise<void> => {
    const { id, ...attributes } = partialUser;

    if (!attributes || Object.keys(attributes).length < 1) return;

    const cmd = new UpdateCommand({
      TableName,
      Key: {
        pk: "USER",
        sk: `USER#${userId}`,
      },
      AttributeUpdates: {
        attributes: { Value: attributes },
      },
    });

    try {
      await documentClient.send(cmd);
    } catch (e: any) {
      logError(e, "updateUser");
      throw new LuciaError("UNKNOWN_ERROR");
      // throw new LuciaError("AUTH_INVALID_USER_ID");
    }
  };

  const deleteUser = async (userId: string): Promise<void> => {
    const cmd = new DeleteCommand({
      TableName,
      Key: {
        pk: `USER`,
        sk: `USER#${userId}`,
      },
    });

    try {
      await documentClient.send(cmd);
    } catch (e: any) {
      logError(e, "deleteUser");
      throw new LuciaError("UNKNOWN_ERROR");
    }
  };

  const getKey = async (keyId: string): Promise<KeySchema | null> => {
    const cmd = new GetCommand({
      TableName,
      Key: {
        pk: "KEY",
        sk: `KEY#${keyId}`,
      },
      ProjectionExpression: "id, hashed_password, user_id",
    });

    try {
      const res = await documentClient.send(cmd);
      return (res?.Item as KeySchema) || null;
    } catch (e: any) {
      logError(e, "getKey");
      return null;
    }
  };

  const getKeysByUserId = async (userId: string): Promise<KeySchema[]> => {
    const cmd = new QueryCommand({
      TableName,
      IndexName: "gsi1",
      KeyConditionExpression:
        "gsi1pk = :pk and begins_with(gsi1sk, :sk_prefix)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":sk_prefix": "KEY#",
      },
      ProjectionExpression: "id, hashed_password, user_id",
    });

    try {
      const res = await documentClient.send(cmd);
      return (res?.Items as KeySchema[]) || [];
    } catch (e: any) {
      logError(e, "getKeysByUserId");
      return [];
    }
  };

  const setKey = async (key: KeySchema): Promise<void> => {
    const { id, hashed_password, user_id } = key;
    const cmd = new PutCommand({
      TableName,
      Item: {
        pk: "KEY",
        sk: `KEY#${id}`,
        gsi1pk: `USER#${user_id}`,
        gsi1sk: `KEY#${id}`,
        type: "key",
        id,
        hashed_password,
        user_id,
      },
      ConditionExpression: "pk <> :pk",
      ExpressionAttributeValues: {
        ":pk": `KEY#${id}`,
      },
    });

    try {
      await documentClient.send(cmd);
    } catch (e: any) {
      logError(e, "setKey");
      throw new LuciaError("UNKNOWN_ERROR");
      // if (e?.code === "ConditionalCheckFailedException") {
      // 	throw new LuciaError("AUTH_DUPLICATE_KEY_ID");
      // }
    }
  };

  const updateKey = async (
    keyId: string,
    partialKey: Partial<KeySchema>
  ): Promise<void> => {
    const { hashed_password } = partialKey;

    const cmd = new UpdateCommand({
      TableName,
      Key: {
        pk: "KEY",
        sk: `KEY#${keyId}`,
      },
      AttributeUpdates: {
        hashed_password: { Value: hashed_password },
      },
    });

    try {
      await documentClient.send(cmd);
    } catch (e: any) {
      logError(e, "updateKey");
      throw new LuciaError("UNKNOWN_ERROR");
    }
  };

  const deleteKey = async (keyId: string): Promise<void> => {
    const cmd = new DeleteCommand({
      TableName,
      Key: {
        pk: "KEY",
        sk: `KEY#${keyId}`,
      },
    });

    try {
      await documentClient.send(cmd);
    } catch (e: any) {
      logError(e, "deleteKey");
      throw new LuciaError("UNKNOWN_ERROR");
    }
  };

  const deleteKeysByUserId = async (userId: string): Promise<void> => {
    const keys = await getKeysByUserId(userId);
    if (keys.length > 0) {
      const cmd = new BatchWriteCommand({
        RequestItems: {
          TableName: keys.map(({ id }) => ({
            DeleteRequest: { Key: { pk: "KEY", sk: `KEY#${id}` } },
          })),
        },
      });
      try {
        await documentClient.send(cmd);
      } catch (e: any) {
        logError(e, "deleteKeysByUserId");
        throw new LuciaError("UNKNOWN_ERROR");
      }
    }
  };

  const getSessionAndUser = async (
    sessionId: string
  ): Promise<[SessionSchema, UserSchema] | [null, null]> => {
    const session = await getSession(sessionId);
    if (!session?.user_id) return [null, null];
    const user = await getUser(session.user_id);
    return [session, user];
  };

  return () => ({
    getSession,
    getSessionsByUserId,
    setSession,
    updateSession,
    deleteSession,
    deleteSessionsByUserId,
    getUser,
    setUser,
    updateUser,
    deleteUser,
    getKey,
    getKeysByUserId,
    setKey,
    updateKey,
    deleteKey,
    deleteKeysByUserId,
    getSessionAndUser,
  });
};

export default adapter;
