import { DynamoDBClient, QueryCommand, UpdateItemCommand} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "eu-north-1" });

export const handler = async (event) => {
    try{
        const body = JSON.parse(event.body);

        const {id} = event.pathParameters;
        const bookingId = `BOOKING#${id}`

        const requiredFields = [
            "singleRooms",
            "doubleRooms",
            "suites",
            "numberOfGuests",
            "name",
            "email",
            "checkIn",
            "checkOut"
        ]

        const missingFields = requiredFields.filter(field => !body.hasOwnProperty(field) || body[field] === "" || body[field] === null);

        if (missingFields.length > 0 ){
            return{
                statusCode: 400,
                body: JSON.stringify({
                    message: `Följande fält saknas eller är tomma: ${missingFields.join(", ")}`
                })
            }
        }

        const singleRooms = Number(body.singleRooms);
        const doubleRooms = Number(body.doubleRooms);
        const suites = Number(body.suites);
        const numberOfGuests = Number(body.numberOfGuests);

        if(isNaN(singleRooms) || isNaN(doubleRooms) || isNaN(suites) || isNaN(numberOfGuests)){
            return{
                statusCode: 400,
                body: JSON.stringify({
                    message: "Felaktiga värden - se till att alla rummen och gästantal är siffror!"
                })
            }
        }

        const updatedTotalRooms = singleRooms + doubleRooms + suites;

        function calculateRoomCapacity(singleRooms, doubleRooms, suites){
            return singleRooms * 1 + doubleRooms * 2 + suites * 3;
        }

        function calculateRoomCost(singleRooms, doubleRooms, suites){
            return singleRooms * 500 + doubleRooms * 1000 + suites * 1500;
        }

        const totalRoomCapacity = calculateRoomCapacity(singleRooms, doubleRooms, suites);
        const totalPrice = calculateRoomCost(singleRooms, doubleRooms, suites);

        if(numberOfGuests > totalRoomCapacity){
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "För många gäster för de valda rummen"
                })
            }
        }

        const getOldBooking = new QueryCommand({
            TableName: "bonzaiAPI",
            KeyConditionExpression: "pk = :pk AND sk = :sk",
            ExpressionAttributeValues: {
                ":pk": { S: "BOOKINGS"},
                ":sk": {S: bookingId}
            }
        });

        const {Items} = await client.send(getOldBooking);

        if(Items.length === 0){
            return{
                statusCode: 404,
                body: JSON.stringify({
                    message: "Bokningen kunde inte hittas"
                })
            };
        }

        const oldBooking = unmarshall(Items[0]);

        const oldTotalRooms = Number(oldBooking.rooms.singleRooms) + Number(oldBooking.rooms.doubleRooms) + Number(oldBooking.rooms.suites);

        const roomDifference = updatedTotalRooms - oldTotalRooms;

        const checkRoomsCommand = new QueryCommand({
            TableName: "bonzaiAPI",
            KeyConditionExpression: "pk = :pk AND sk = :sk",
            ExpressionAttributeValues: {
                ":pk": {S: "ADMIN"},
                ":sk": {S: "totalRoomsBooked"}
            }
        });

        const {Items: roomItems} = await client.send(checkRoomsCommand); 
        const currentTotal = roomItems.length > 0 ? parseInt(unmarshall(roomItems[0]).totalRoomsBooked, 10) : 0;

        const maxRooms = 20;

        if (currentTotal + roomDifference > maxRooms) {
            const remaining = maxRooms - currentTotal;
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: `Det finns inte tillräckligt många rum kvar. Endast ${remaining} tillgängliga.`
                })
            };
        }

        const updateBookingCommand = new UpdateItemCommand({
        TableName: "bonzaiAPI",
        Key: {
            pk: { S: "BOOKINGS" },
            sk: { S: bookingId }
        },
        UpdateExpression: `SET
            numberOfGuests = :guests,
            rooms = :rooms,
            #name = :name,
            email = :email,
            checkIn = :checkIn,
            checkOut = :checkOut,
            totalPrice = :totalPrice`,
        ExpressionAttributeNames: {
            "#name": "name"
        },
        ExpressionAttributeValues: {
            ":guests": { N: numberOfGuests.toString() },
            ":rooms": {
                M: {
                    singleRooms: { N: singleRooms.toString() },
                    doubleRooms: { N: doubleRooms.toString() },
                    suites: { N: suites.toString() }
                }
            },
            ":name": { S: body.name },
            ":email": { S: body.email },
            ":checkIn": { S: body.checkIn },
            ":checkOut": { S: body.checkOut },
            ":totalPrice": { N: totalPrice.toString() }
        },
        ReturnValues: "UPDATED_NEW"
    });

        const updateRoomsCommand = new UpdateItemCommand({
            TableName: "bonzaiAPI",
            Key: {
                pk: { S: "ADMIN" },
                sk: { S: "totalRoomsBooked" }
            },
            UpdateExpression: "SET totalRoomsBooked = totalRoomsBooked + :diff",
            ExpressionAttributeValues: {
                ":diff": { N: roomDifference.toString() }
            },
            ReturnValues: "UPDATED_NEW"
        });

        await client.send(updateBookingCommand);
        await client.send(updateRoomsCommand);

        return{
            statusCode:200,
            body: JSON.stringify({
                message: `Bokning ${bookingId} har uppdaterats`,
                booking: bookingId
            })
        }  
    
    } catch (err) {
        return {
        statusCode: 500,
        body: JSON.stringify({ error: err.message }),
        };
  }
}