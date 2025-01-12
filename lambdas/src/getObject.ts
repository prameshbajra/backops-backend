import { DynamoDBClient, GetItemCommand, GetItemCommandInput } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { internalServerErrorResponse, respond, validateAccessToken, unauthorizedResponse } from './utility';

const dynamoDbClient = new DynamoDBClient({});
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const accessToken = validateAccessToken(event);
    if (!accessToken) return unauthorizedResponse();

    const body = JSON.parse(event.body || '{}');
    const { PK, SK } = body;

    if (!PK || !SK) {
        return internalServerErrorResponse('PK and SK must be provided');
    }

    try {
        const params: GetItemCommandInput = {
            TableName: DYNAMODB_TABLE,
            Key: {
                PK: { S: PK },
                SK: { S: SK },
            },
        };

        const data = await dynamoDbClient.send(new GetItemCommand(params));

        if (!data.Item) {
            return respond({ message: 'Item not found' }, 404);
        }

        const item = unmarshall(data.Item);

        return respond({ item });
    } catch (error) {
        console.error('Error retrieving item from DynamoDB:', error);
        return internalServerErrorResponse('Failed to retrieve item from DynamoDB');
    }
};
