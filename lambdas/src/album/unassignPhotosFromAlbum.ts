import { DynamoDBClient, UpdateItemCommand, BatchGetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
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

interface PhotoVideoItem {
    PK: string;
    SK: string;
    fileName: string;
    fileSize: number;
    albumId?: string;
}

const getPhotosVideos = async (userId: string, items: Array<{ PK: string; SK: string }>): Promise<PhotoVideoItem[]> => {
    if (items.length === 0) return [];

    const keys = items.map((item) => marshall({ PK: item.PK, SK: item.SK }));

    const params = {
        RequestItems: {
            [DYNAMODB_TABLE]: {
                Keys: keys,
            },
        },
    };

    try {
        const result = await dynamoDbClient.send(new BatchGetItemCommand(params));
        const dbItems = result.Responses?.[DYNAMODB_TABLE] || [];

        return dbItems
            .map((item) => unmarshall(item) as PhotoVideoItem)
            .filter((item) => item.PK === userId && !item.SK.startsWith('ALBUM#')); // Only photos/videos, not albums
    } catch (error) {
        console.error('Error getting photos/videos:', error);
        return [];
    }
};

const unassignPhotosFromAlbum = async (
    userId: string,
    albumId: string | null,
    items: Array<{ PK: string; SK: string }>,
): Promise<{ success: number; failed: number; errors: string[] }> => {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    const fullAlbumId = albumId ? (albumId.startsWith('ALBUM#') ? albumId : `ALBUM#${albumId}`) : null;

    for (const item of items) {
        try {
            const updateExpression = 'REMOVE albumId SET updatedAt = :updatedAt';
            let conditionExpression = 'PK = :userId AND attribute_exists(PK)';
            const expressionAttributeValues: any = {
                ':updatedAt': new Date().toISOString(),
                ':userId': userId,
            };

            if (fullAlbumId) {
                conditionExpression += ' AND albumId = :currentAlbumId';
                expressionAttributeValues[':currentAlbumId'] = fullAlbumId;
            }

            const params = {
                TableName: DYNAMODB_TABLE,
                Key: marshall({ PK: item.PK, SK: item.SK }),
                UpdateExpression: updateExpression,
                ConditionExpression: conditionExpression,
                ExpressionAttributeValues: marshall(expressionAttributeValues),
            };

            await dynamoDbClient.send(new UpdateItemCommand(params));
            success++;
        } catch (error: any) {
            failed++;
            console.error(`Error unassigning item ${item.SK} from album:`, error);

            if (error.name === 'ConditionalCheckFailedException') {
                if (fullAlbumId) {
                    errors.push(`${item.SK} is not assigned to the specified album`);
                } else {
                    errors.push(`${item.SK} does not exist or is not owned by user`);
                }
            } else {
                errors.push(`Failed to unassign ${item.SK}: ${error.message || 'Unknown error'}`);
            }
        }
    }

    return { success, failed, errors };
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
        const { items } = body;

        if (!Array.isArray(items) || items.length === 0) {
            return customErrorResponse(400, 'items array is required and cannot be empty');
        }

        // Validate items format
        for (const item of items) {
            if (!item.PK || !item.SK || item.PK !== cognitoUserId) {
                return customErrorResponse(400, 'Invalid item format or unauthorized access');
            }
        }

        // Get existing photos/videos to verify they exist
        const existingItems = await getPhotosVideos(cognitoUserId, items);
        if (existingItems.length !== items.length) {
            return customErrorResponse(400, 'Some items do not exist or are not photos/videos');
        }

        // Unassign photos/videos from album
        // albumId can be null to unassign from any album, or specific albumId to only unassign from that album
        const result = await unassignPhotosFromAlbum(cognitoUserId, albumId || null, items);

        const message = albumId
            ? `Unassignment from album completed. ${result.success} items unassigned successfully.`
            : `Unassignment from all albums completed. ${result.success} items unassigned successfully.`;

        return respond({
            message,
            success: result.success,
            failed: result.failed,
            ...(result.errors.length > 0 && { errors: result.errors }),
        });
    } catch (error) {
        console.error('Lambda execution error:', error);
        if (error instanceof SyntaxError) {
            return customErrorResponse(400, 'Invalid JSON in request body');
        }
        return internalServerErrorResponse('An unexpected error occurred while unassigning photos from album');
    }
};
