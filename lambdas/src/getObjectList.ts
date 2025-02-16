import { DynamoDBClient, QueryCommand, QueryCommandInput } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from './utility';

const dynamoDbClient = new DynamoDBClient({});
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;
const PAGE_SIZE = 100;

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
    const { nextToken, timestampPrefix } = body;

    try {
        const params: QueryCommandInput = {
            TableName: DYNAMODB_TABLE,
            KeyConditionExpression: 'PK = :cognitoUserId',
            ExpressionAttributeValues: {
                ':cognitoUserId': { S: cognitoUserId },
            },
            ProjectionExpression: 'PK, SK, fileName, fileSize',
            ScanIndexForward: false, // For descending order
            Limit: PAGE_SIZE,
        };

        if (timestampPrefix) {
            params.KeyConditionExpression += ' AND begins_with(SK, :timestampPrefix)';
            if (params.ExpressionAttributeValues) {
                params.ExpressionAttributeValues[':timestampPrefix'] = { S: timestampPrefix };
            }
        }

        if (nextToken) {
            params.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf-8'));
        }

        const data = await dynamoDbClient.send(new QueryCommand(params));
        const items = data.Items ? data.Items.map((item) => unmarshall(item)) : [];

        const nextTokenResponse = data.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64')
            : null;

        return respond({
            items,
            nextToken: nextTokenResponse,
        });
    } catch (error) {
        console.error('Error querying DynamoDB:', error);
        return internalServerErrorResponse('Failed to query items from DynamoDB');
    }
};
