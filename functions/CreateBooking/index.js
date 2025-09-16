import { DynamoDBClient, PutItemCommand, QueryCommand, UpdateItemCommand} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({ region: "eu-north-1" });

export const handler = async (event) => {
    const body = JSON.parse(event.body);

    const singleRooms = Number(body.singleRooms);
    const doubleRooms = Number(body.doubleRooms);
    const suites = Number(body.suites);

    function calculateRoomCapacity(singleRooms, doubleRooms, suites){
        return singleRooms * 1 + doubleRooms * 2 + suites * 3;
    }

    function calculateRoomCost(singleRooms, doubleRooms, suites){
        return singleRooms * 500 + doubleRooms * 1000 + suites * 1500;
    }

    const totalRoomCapacity = calculateRoomCapacity(singleRooms, doubleRooms, suites);
    const totalPrice = calculateRoomCost(singleRooms, doubleRooms, suites);
    
    if (body.numbersOfGuests > totalRoomCapacity) {
        throw new Error ("Det går inte, det är för många gäster och för få rum!")
    }

    const bookingId = `BOOKING#${uuidv4().toUpperCase().slice(0, 5)}`;
    
    const booking = {
        pk: { S: "BOOKINGS" },
        sk: { S: bookingId},
        numbersOfGuests: {N: body.numbersOfGuests.toString()},
        rooms: { 
            M: {
                singleRooms: { N: singleRooms.toString()},
                doubleRooms: { N: doubleRooms.toString() },
                suites: { N: suites.toString() }
            }
        },
        name: {S: body.name},
        email: {S: body.email},
        checkIn: {S: body.checkIn},
        checkOut: {S: body.checkOut},
        totalPrice: {N: totalPrice.toString()},
    }

    const checkRoomsCommand = new QueryCommand({
        TableName: "bonzaiAPI",
        KeyConditionExpression: "pk = :pk AND sk = :sk",
        ExpressionAttributeValues: {
        ":pk": { S: "ADMIN" },
        ":sk": { S: "totalRoomsBooked" }
    },  
});
    const bookedRooms = singleRooms + doubleRooms + suites;
    const { Items } = await client.send(checkRoomsCommand);
    
    const currentTotal = Items.length > 0 ? parseInt(unmarshall(Items[0]).totalRoomsBooked, 10): 0;
    
    const MAX_ROOMS = 20;

    if (currentTotal + bookedRooms > MAX_ROOMS) {
    const remaining = MAX_ROOMS - currentTotal;
    const remainingRooms = remaining > 0 ? remaining : 0;

    return {
        statusCode: 400,
        body: JSON.stringify({
            message: `Det gick ej att genomföra bokningen. Vi har endast ${remainingRooms} rum kvar`
        })
    }
    //throw new Error(`Det gick ej att genomföra bokningen. Vi har endast ${remainingRooms} rum kvar`);
    }

    const createBookingCommand = new PutItemCommand({
        TableName: "bonzaiAPI",
        Item: booking
    });

    const updateRoomsCommand = new UpdateItemCommand({
        TableName: "bonzaiAPI",
        Key: {
            pk: { S: "ADMIN" },
            sk: { S: "totalRoomsBooked" }
        },
        UpdateExpression:
        "SET totalRoomsBooked = if_not_exists(totalRoomsBooked, :zero) + :bookedRooms",
        ExpressionAttributeValues: {
            ":bookedRooms": { N: bookedRooms.toString() },
            ":zero": { N: "0" }
        },
        ReturnValues: "UPDATED_NEW"
    });
    
    await client.send(createBookingCommand);
    await client.send(updateRoomsCommand);

    return{
        statusCode:200,
        body: JSON.stringify({
            message: `Din order har lagts in!`,
            booking: booking
        })
    }    
}

