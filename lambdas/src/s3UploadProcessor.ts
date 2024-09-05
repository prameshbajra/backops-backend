import { Context, EventBridgeEvent, EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;

interface S3ObjectDetail {
    key: string;
    size: number;
}

// Initialize DynamoDB client
const dynamoDbClient = new DynamoDBClient({});

export const lambdaHandler: EventBridgeHandler<'ObjectCreated', { object: S3ObjectDetail }, void> = async (
    event: EventBridgeEvent<'ObjectCreated', { object: S3ObjectDetail }>,
    _context: Context,
) => {
    const fileDetails = event.detail.object;
    const { key, size } = fileDetails;
    const [userId, fileName] = key.split('/');

    const currentDate = new Date().toISOString();
    const item = {
        userId: userId,
        date: currentDate,
        fileName: fileName,
        fileSize: size,
    };
    console.log('Item to be inserted into DynamoDB:', item);

    const params = {
        TableName: DYNAMODB_TABLE,
        Item: marshall(item),
    };

    try {
        const command = new PutItemCommand(params);
        await dynamoDbClient.send(command);
        console.log('Data successfully inserted into DynamoDB');
    } catch (error) {
        console.error('Error inserting data into DynamoDB:', error);
    }
};
