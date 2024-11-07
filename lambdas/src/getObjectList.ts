import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from './utility';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoDbClient = new DynamoDBClient({});
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const accessToken = validateAccessToken(event);
    if (!accessToken) return unauthorizedResponse();

    const userResponse = await getUserInfo(accessToken);
    if (!userResponse) return internalServerErrorResponse('Failed to get user info');

    const cognitoUserId = userResponse.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;
    if (!cognitoUserId) {
        console.warn('Cannot find user.');
        return unauthorizedResponse();
    }

    const body = JSON.parse(event.body || '{}');
    const { date } = body;

    try {
        const params = {
            TableName: DYNAMODB_TABLE,
            KeyConditionExpression: 'PK = :cognitoUserId AND begins_with(SK, :skPrefix)',
            ExpressionAttributeValues: {
                ':cognitoUserId': { S: cognitoUserId },
                ':skPrefix': { S: date },
            },
            ScanIndexForward: false,
        };

        const data = await dynamoDbClient.send(new QueryCommand(params));
        const items = data.Items ? data.Items.map((item) => unmarshall(item)) : [];
        return respond({ items });
    } catch (error) {
        console.error('Error querying DynamoDB:', error);
        return internalServerErrorResponse('Failed to query items from DynamoDB');
    }
};
