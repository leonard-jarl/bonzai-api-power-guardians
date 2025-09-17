import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
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


const isEmail = (s) => typeof s === "string" && /^\S+@\S+\.\S+$/.test(s);
const capacity = (single, double, suite) => single + 2*double + 3*suite;
const roomCount = (single, double, suite) => single + double + suite;
const priceForStay = (single, double, suite, nights) =>
  (single*500 + double*1000 + suite*1500) * nights;


export const handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  try {
    if (!event?.body) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Saknar request body" }) };
    }
    const body = JSON.parse(event.body);

    const singleRooms = Number(body.singleRooms);
    const doubleRooms = Number(body.doubleRooms);
    const suites = Number(body.suites);
    const name  = (body.name ?? "").trim();
    const email = (body.email ?? "").trim();
    const numbersOfGuests = Number(body.numbersOfGuests);
    const checkIn  = (body.checkIn  ?? "").trim();
    const checkOut = (body.checkOut ?? "").trim();


    if (!name || name.length > 100) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Skriv in ett namn (max 100 tecken)." }),
      };
    }

    if (!isEmail(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Mejladressen formatet är fel. Testa med formatet namn@exempel.se." }),
      };
    }

    if (!Number.isInteger(numbersOfGuests) || numbersOfGuests <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Ange antal gäster som är större än 0." }),
      };
    }

    for (const value of [singleRooms, doubleRooms, suites]) {
      if (!Number.isInteger(value) || value < 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Antalet rum måste vara heltal och kan inte vara negativt." }),
        };
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

    if (capacity(singleRooms, doubleRooms, suites) !== numbersOfGuests) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Antalet gäster måste matcha rummens kapacitet.",
        }),
      };
    }

    const listExisting = new QueryCommand({
      TableName: "bonzaiAPI",
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": { S: "BOOKINGS" }, ":sk": { S: "BOOKING#" } }
    });
    const existingBookingsResult = await client.send(listExisting);
    const occupiedRooms = (existingBookingsResult.Items ?? [])
      .map((rawItem) => unmarshall(rawItem))
      .filter((booking) => (booking.status ?? "CONFIRMED") === "CONFIRMED")
      .reduce((totalOccupiedRooms, booking) => {
        const existingSingleRooms = Number(booking?.rooms?.singleRooms ?? booking.single ?? 0);
        const existingDoubleRooms = Number(booking?.rooms?.doubleRooms ?? booking.double ?? 0);
        const existingSuites      = Number(booking?.rooms?.suites ?? booking.suite ?? 0);
        return totalOccupiedRooms + existingSingleRooms + existingDoubleRooms + existingSuites;
  }, 0);


    const requestedRooms = roomCount(singleRooms, doubleRooms, suites);
    const MAX_ROOMS = 20;
    if (occupiedRooms + requestedRooms > MAX_ROOMS) {
      const remaining = Math.max(0, MAX_ROOMS - occupiedRooms);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Det gick ej att genomföra bokningen. Vi har endast ${remaining} rum kvar.` })
      };
    }

    const bookingId = `BOOKING#${uuidv4().toUpperCase().slice(0, 5)}`;
    const createdAt = new Date().toISOString();
    const modifiedAt = createdAt;
    const totalPrice = priceForStay(singleRooms, doubleRooms, suites, nights);

    const bookingItem = {
      id: { S: bookingId },
      name: { S: name },
       email: { S: email },
      numbersOfGuests: { N: String(numbersOfGuests) },
      rooms: {
        M: {
          singleRooms: { N: String(singleRooms) },
          doubleRooms: { N: String(doubleRooms) },
          suites:      { N: String(suites) }
        }
      },
      checkIn:    { S: checkIn },
      checkOut:   { S: checkOut },
      nights:     { N: String(nights) },         
      totalPrice: { N: String(totalPrice) },     
      status:     { S: "CONFIRMED" },            
      createdAt:  { S: createdAt },              
      modifiedAt: { S: modifiedAt }             
    };


    const putList = new PutItemCommand({
      TableName: "bonzaiAPI",
      Item: {
         pk: { S: "BOOKINGS" }, 
         sk: { S: bookingId }, 
         ...bookingItem },
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
    });

   
    const putMeta = new PutItemCommand({
      TableName: "bonzaiAPI",
      Item: { 
        pk: { S: bookingId }, 
        sk: { S: `META#${name}` }, 
        ...bookingItem },
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
    });

    await client.send(putList);
    await client.send(putMeta);

    
    const confirmation = {
      bookingNumber: bookingId,
      guestName: name,
      guests: numbersOfGuests,
      rooms: { single: singleRooms, double: doubleRooms, suite: suites },
      checkIn,
      checkOut,
      nights,
      totalPrice
    };

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ success: true, confirmation })
    };

  } catch (err) {
    console.error(err);


    if (err instanceof SyntaxError) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "ogiltig JSON i request body" }) };
    }
    if (err?.name === "ConditionalCheckFailedException") {
      return { statusCode: 409, headers, body: JSON.stringify({ error: "Kunde inte skapa bokningen" }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Något gick fel i server" }) };
  }
};