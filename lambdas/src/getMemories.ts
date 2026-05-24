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
const PER_YEAR_LIMIT = 50;
const PROJECTION = 'PK, SK, fileName, fileSize, imageId, albumId, imageMetadata, createdAt, updatedAt';

interface MemoryGroup {
    year: string;
    items: Record<string, unknown>[];
}

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

const getOldestYear = async (cognitoUserId: string): Promise<number | null> => {
    const params: QueryCommandInput = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'PK = :cognitoUserId AND SK < :albumPrefix',
        ExpressionAttributeValues: {
            ':cognitoUserId': { S: cognitoUserId },
            ':albumPrefix': { S: 'ALBUM#' },
        },
        ProjectionExpression: 'SK',
        ScanIndexForward: true,
        Limit: 1,
    };

    const data = await dynamoDbClient.send(new QueryCommand(params));
    if (!data.Items || data.Items.length === 0) return null;

    const sk = data.Items[0].SK?.S;
    if (!sk) return null;

    const parsed = new Date(sk);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.getUTCFullYear();
};

const queryYear = async (cognitoUserId: string, year: number, monthDay: string): Promise<Record<string, unknown>[]> => {
    const prefix = `${year}-${monthDay}`;
    const params: QueryCommandInput = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'PK = :cognitoUserId AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
            ':cognitoUserId': { S: cognitoUserId },
            ':prefix': { S: prefix },
        },
        ProjectionExpression: PROJECTION,
        ScanIndexForward: false,
        Limit: PER_YEAR_LIMIT,
    };

    const data = await dynamoDbClient.send(new QueryCommand(params));
    if (!data.Items) return [];

    return data.Items.map((item) => unmarshall(item)).filter(
        (item) => typeof item.SK === 'string' && !item.SK.startsWith('ALBUM#'),
    );
};

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
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const monthDay = `${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

        const oldestYear = await getOldestYear(cognitoUserId);
        if (oldestYear === null) {
            return respond({ memories: [] });
        }

        const endYear = currentYear - 1;
        if (endYear < oldestYear) {
            return respond({ memories: [] });
        }

        const memories: MemoryGroup[] = [];
        for (let year = endYear; year >= oldestYear; year--) {
            const items = await queryYear(cognitoUserId, year, monthDay);
            if (items.length === 0) continue;
            memories.push({ year: `${year}`, items });
        }

        return respond({ memories });
    } catch (error) {
        console.error('Error querying memories from DynamoDB:', error);
        return internalServerErrorResponse('Failed to query memories from DynamoDB');
    }
};
