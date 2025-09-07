import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    customErrorResponse,
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from '../utility';

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;
const dynamoDbClient = new DynamoDBClient({});
const PAGE_SIZE = 100;

interface PhotoVideoItem {
    PK: string;
    SK: string;
    fileName: string;
    fileSize: number;
    imageId?: string;
    albumId?: string;
    createdAt?: string;
    updatedAt?: string;
    imageMetadata?: any;
}

const getAlbumPhotos = async (
    userId: string,
    albumId: string,
    nextToken?: string,
): Promise<{
    items: PhotoVideoItem[];
    nextToken: string | null;
}> => {
    const fullAlbumId = albumId.startsWith('ALBUM#') ? albumId : `ALBUM#${albumId}`;

    // Use Query with filter expression - more efficient than scan
    const params: any = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'PK = :userId AND SK < :albumPrefix',
        FilterExpression: 'albumId = :albumId',
        ExpressionAttributeValues: {
            ':userId': { S: userId },
            ':albumId': { S: fullAlbumId },
            ':albumPrefix': { S: 'ALBUM#' },
        },
        ProjectionExpression: 'PK, SK, fileName, fileSize, imageId, albumId, createdAt, updatedAt, imageMetadata',
        ScanIndexForward: false, // Sort by SK in descending order
        Limit: PAGE_SIZE,
    };

    if (nextToken) {
        params.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf-8'));
    }

    try {
        const result = await dynamoDbClient.send(new QueryCommand(params));
        const items = result.Items ? result.Items.map((item) => unmarshall(item) as PhotoVideoItem) : [];

        const nextTokenResponse = result.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
            : null;

        return {
            items,
            nextToken: nextTokenResponse,
        };
    } catch (error) {
        console.error('Error querying album photos:', error);
        throw error;
    }
};

const verifyAlbumExists = async (userId: string, albumId: string): Promise<boolean> => {
    const params = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'PK = :userId AND SK = :albumId',
        ExpressionAttributeValues: {
            ':userId': { S: userId },
            ':albumId': { S: albumId.startsWith('ALBUM#') ? albumId : `ALBUM#${albumId}` },
        },
        Limit: 1,
    };

    try {
        const result = await dynamoDbClient.send(new QueryCommand(params));
        return !!(result.Items && result.Items.length > 0);
    } catch (error) {
        console.error('Error verifying album exists:', error);
        return false;
    }
};

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    try {
        const accessToken = validateAccessToken(event);
        if (!accessToken) return unauthorizedResponse();

        const userResponse = await getUserInfo(accessToken);
        if (!userResponse) return internalServerErrorResponse('Failed to get user info');

        const cognitoUserId = userResponse.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;
        if (!cognitoUserId) return unauthorizedResponse();

        const { albumId } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');
        const { nextToken } = body;

        if (!albumId?.trim()) {
            return customErrorResponse(400, 'albumId is required');
        }

        const albumExists = await verifyAlbumExists(cognitoUserId, albumId);
        if (!albumExists) {
            return customErrorResponse(404, 'Album not found');
        }

        const result = await getAlbumPhotos(cognitoUserId, albumId, nextToken);

        return respond({
            items: result.items,
            nextToken: result.nextToken,
            count: result.items.length,
        });
    } catch (error) {
        console.error('Lambda execution error:', error);
        if (error instanceof SyntaxError) {
            return customErrorResponse(400, 'Invalid JSON in request body');
        }
        return internalServerErrorResponse('An unexpected error occurred while fetching album photos');
    }
};
