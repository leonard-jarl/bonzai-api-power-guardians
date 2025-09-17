import { DynamoDBClient, DeleteItemCommand, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "eu-north-1" });

export const handler = async (event) => {
  try {
    const id = event.pathParameters.id;
    if (!id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing id in path" }),
      };
    }
    const bookingId = `BOOKING#${id}`;

    // hämtar bokningen
    let booking;
    try {
    const getParams = {
      TableName: "bonzaiAPI",
      Key: { pk: { S: "BOOKINGS" }, sk: { S: bookingId } },
    };

    const getCommand = new GetItemCommand(getParams);
    const getResult = await client.send(getCommand);

    if (!getResult.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Booking ${bookingId} not found` }),
      };
    }

    booking = unmarshall(getResult.Item);

  } catch (err) {
    return {
      statusCode: 500,
      body: JASON.stringify({ error: "Failed to connect to DynamoDB to fetch booking"})
    }
  }

    // räknar ut antalet rum
try {
    const singleRooms = Number(booking.rooms?.singleRooms || 0);
    const doubleRooms = Number(booking.rooms?.doubleRooms || 0);
    const suites = Number(booking.rooms?.suites || 0);
    const totalRoomsBooked = singleRooms + doubleRooms + suites;

    // updaterar admin
    const updateAdminCommand = new UpdateItemCommand({
      TableName: "bonzaiAPI",
      Key: { pk: { S: "ADMIN" }, sk: { S: "totalRoomsBooked" } },
      UpdateExpression: "SET totalRoomsBooked = if_not_exists(totalRoomsBooked, :zero) - :roomsToRemove",
      ExpressionAttributeValues: {
        ":roomsToRemove": { N: totalRoomsBooked.toString() },
        ":zero": { N: "0" },
      },
      ReturnValues: "UPDATED_NEW",
    });

    await client.send(updateAdminCommand);

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to communicate with DynamoDB to update admin totals" }),
    };
  }

    // raderar bokningen
    try {
      const getParams = {
        TableName: "bonzaiAPI",
        Key: { pk: { S: "BOOKINGS" }, sk: { S: bookingId } },
      };
  
      const deleteCommand = new DeleteItemCommand(getParams);
      await client.send(deleteCommand);
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Failed to delete booking: ${err.message}` }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Booking ${bookingId} deleted` }),
    };
    
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
