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
const GEO_PREFIX = 'GEO#';
const PAGE_LIMIT = 1000;
const PROJECTION = 'SK, lat, lng, imageId, fileName, originalSK';

interface GeoPoint {
    originalSK: string;
    lat: number;
    lng: number;
    fileName: string;
    imageId?: string;
}

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

    try {
        const params: QueryCommandInput = {
            TableName: DYNAMODB_TABLE,
            KeyConditionExpression: 'PK = :userId AND begins_with(SK, :geoPrefix)',
            ExpressionAttributeValues: {
                ':userId': { S: cognitoUserId },
                ':geoPrefix': { S: GEO_PREFIX },
            },
            ProjectionExpression: PROJECTION,
            Limit: PAGE_LIMIT,
        };

        const data = await dynamoDbClient.send(new QueryCommand(params));
        if (!data.Items || data.Items.length === 0) {
            return respond({ points: [] });
        }

        const points: GeoPoint[] = [];
        for (const raw of data.Items) {
            const item = unmarshall(raw);
            const lat = item.lat;
            const lng = item.lng;
            if (typeof lat !== 'number' || typeof lng !== 'number') continue;

            const sk = typeof item.SK === 'string' ? item.SK : '';
            const originalSK =
                typeof item.originalSK === 'string' && item.originalSK.length > 0
                    ? item.originalSK
                    : sk.startsWith(GEO_PREFIX)
                    ? sk.slice(GEO_PREFIX.length)
                    : sk;

            const fileName = typeof item.fileName === 'string' ? item.fileName : '';

            const point: GeoPoint = { originalSK, lat, lng, fileName };
            if (typeof item.imageId === 'string' && item.imageId.length > 0) {
                point.imageId = item.imageId;
            }
            points.push(point);
        }

        return respond({ points });
    } catch (error) {
        console.error('Error querying geo points from DynamoDB:', error);
        return internalServerErrorResponse('Failed to query geo points from DynamoDB');
    }
};
