import { DynamoDBClient, PutItemCommand, QueryCommand, UpdateItemCommand} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({ region: "eu-north-1" });

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const toMidnightUTC = (dateString) => {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const dateAtMidnight = new Date(`${dateString}T00:00:00.000Z`);
  return Number.isNaN(dateAtMidnight.getTime()) ? null : dateAtMidnight;
};

const calcNights = (checkInString, checkOutString) => {
  const checkInDate = toMidnightUTC(checkInString);
  const checkOutDate = toMidnightUTC(checkOutString);
  if (!checkInDate || !checkOutDate) return NaN;
  return Math.round((checkOutDate - checkInDate) / ONE_DAY_MS);
};

export const handler = async (event) => {
    const headers = { "Content-Type": "application/json" };

    try{

        if (!event?.body) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Saknar request body" }) };
        }

        const body = JSON.parse(event.body);
        const isEmail = (s) => typeof s === "string" && /^\S+@\S+\.\S+$/.test(s);
        const name  = (body.name ?? "").trim();
        const singleRooms = Number(body.singleRooms);
        const doubleRooms = Number(body.doubleRooms);
        const suites = Number(body.suites);
        const checkIn  = (body.checkIn  ?? "").trim();
        const checkOut = (body.checkOut ?? "").trim();

        if (!name || name.length > 100) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Skriv in ett namn (max 100 tecken)." }),
        };
        }

        if (!isEmail(body.email)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: "Mejladressen formatet är fel. Testa med formatet namn@exempel.se." }),
            };
        }

        if (!Number.isInteger(body.numbersOfGuests) || body.numbersOfGuests <= 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: "Ange antal gäster som är större än 0." }),
            };
        }

        function calculateRoomCapacity(singleRooms, doubleRooms, suites){
            return singleRooms * 1 + doubleRooms * 2 + suites * 3;
        }

        function calculateRoomCost(singleRooms, doubleRooms, suites){
            return singleRooms * 500 + doubleRooms * 1000 + suites * 1500;
        }

        const totalRoomCapacity = calculateRoomCapacity(singleRooms, doubleRooms, suites);
        const totalPrice = calculateRoomCost(singleRooms, doubleRooms, suites);

        for (const value of [singleRooms, doubleRooms, suites]) {
                if (!Number.isInteger(value) || value < 0) {
                    return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Antalet rum måste vara heltal och kan inte vara negativt." }),
                    };
                }
        }
        
        if (body.numbersOfGuests > totalRoomCapacity) {
            return{
                statusCode: 400,
                headers,
                body: JSON.stringify({error: "Det går inte, det är för många gäster och för få rum!"})
            }
        }

        const nights = calcNights(checkIn, checkOut);
        if (!Number.isFinite(nights) || nights < 1) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                error: "Datum ser fel ut. Använd YYYY-MM-DD och se till att incheckning är före utcheckning.",
                }),
            };
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
            checkIn: {S: checkIn},
            checkOut: {S: checkOut},
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

        const confirmation = {
        bookingNumber: bookingId,
        guestName: body.name,
        guests: body.numbersOfGuests,
        rooms: { single: singleRooms, double: doubleRooms, suite: suites },
        checkIn: checkIn,
        checkOut: checkOut,
        nights: nights,
        totalPrice: body.totalPrice
        };

        return{
            statusCode:200,
            body: JSON.stringify({
                message: `Din order har lagts in!`,
                booking: confirmation
            })
        }

        } catch (err){
             console.error(err);
              if (err instanceof SyntaxError) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: "ogiltig JSON i request body" }) };
                }
                if (err?.name === "ConditionalCheckFailedException") {
                return { statusCode: 409, headers, body: JSON.stringify({ error: "Kunde inte skapa bokningen" }) };
                }
                return { statusCode: 500, headers, body: JSON.stringify({ error: "Något gick fel i server" }) };
            }
        }  


