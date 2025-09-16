import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "eu-north-1" });

export const handler = async (event) => {
  const command = new QueryCommand({
    TableName: "bonzaiAPI",
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: {
      ":pk": { S: "BOOKINGS" },
    }
  });

  const { Items = [] } = await client.send(command);

  const bookings = Items.map((item) => unmarshall(item));

  if (bookings.length === 0) {
   return {
    statusCode: 404,
    body: JSON.stringify({
      message: `Det finns inga bokningar just nu.`,
    }),
  };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: `Det funkar! Här är alla nuvarande bokningar`,
      bookings: bookings,
    }),
  };
};