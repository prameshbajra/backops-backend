import { DynamoDBClient, QueryCommand, QueryCommandInput } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { internalServerErrorResponse, respond, validateAccessToken, unauthorizedResponse } from '../utility';

const dynamoDbClient = new DynamoDBClient({});
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const accessToken = validateAccessToken(event);
    if (!accessToken) return unauthorizedResponse();

    const body = JSON.parse(event.body || '{}');
    const { PK } = body;

    if (!PK) {
        return internalServerErrorResponse('PK must be provided');
    }

    try {
        const params: QueryCommandInput = {
            TableName: DYNAMODB_TABLE,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
                ':pk': { S: PK },
            },
        };

        const data = await dynamoDbClient.send(new QueryCommand(params));

        if (!data.Items || data.Items.length === 0) {
            return respond({ message: 'No items found' }, 404);
        }

        const items = data.Items.map((item) => unmarshall(item));

        return respond(items);
    } catch (error) {
        console.error('Error querying items from DynamoDB:', error);
        return internalServerErrorResponse('Failed to query items from DynamoDB');
    }
};
