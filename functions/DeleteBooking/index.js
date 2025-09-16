import { DynamoDBClient, DeleteItemCommand, GetItemCommand  } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "eu-north-1" });

export const handler = async (event) => {

    try {
        const bookingId = event.pathParameters.id;

        if(!bookingId){
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing id in path"})
            }
        }

        const getParams = {
            TableName: "bonzaiAPI",
            Key: {
                pk: { S: "BOOKINGS"},
                sk: { S: bookingId}
            }
        };
        const getCommand = new GetItemCommand(getParams);
        const getResult = await client.send(getCommand);
    
        if (!getResult.Item) {
          return {
            statusCode: 404,
            body: JSON.stringify({ error: `Booking ${bookingId} not found` }),
          };
        }

        const command = new DeleteItemCommand(getParams);
        await client.send(command);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Booking ${bookingId} deleted`})
        }
         

    } catch (err){
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message})

        }
    }
}