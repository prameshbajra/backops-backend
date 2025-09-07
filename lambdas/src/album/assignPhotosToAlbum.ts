import { BatchGetItemCommand, DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
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

const verifyAlbumExists = async (userId: string, albumId: string): Promise<boolean> => {
    const params = {
        TableName: DYNAMODB_TABLE,
        Key: marshall({ PK: userId, SK: albumId.startsWith('ALBUM#') ? albumId : `ALBUM#${albumId}` }),
    };

    try {
        const result = await dynamoDbClient.send(new GetItemCommand(params));
        return !!result.Item;
    } catch (error) {
        console.error('Error verifying album exists:', error);
        return false;
    }
};

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
            .filter((item) => item.PK === userId && !item.SK.startsWith('ALBUM#'));
    } catch (error) {
        console.error('Error getting photos/videos:', error);
        return [];
    }
};

const assignPhotosToAlbum = async (
    userId: string,
    albumId: string,
    items: Array<{ PK: string; SK: string }>,
): Promise<{ success: number; failed: number; errors: string[] }> => {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    const fullAlbumId = albumId.startsWith('ALBUM#') ? albumId : `ALBUM#${albumId}`;

    for (const item of items) {
        try {
            const params = {
                TableName: DYNAMODB_TABLE,
                Key: marshall({ PK: item.PK, SK: item.SK }),
                UpdateExpression: 'SET albumId = :albumId, updatedAt = :updatedAt',
                ConditionExpression: 'PK = :userId AND attribute_exists(PK)',
                ExpressionAttributeValues: marshall({
                    ':albumId': fullAlbumId,
                    ':updatedAt': new Date().toISOString(),
                    ':userId': userId,
                }),
            };

            await dynamoDbClient.send(new UpdateItemCommand(params));
            success++;
        } catch (error) {
            failed++;
            console.error(`Error assigning item ${item.SK} to album:`, error);
            errors.push(`Failed to assign ${item.SK}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

        if (!albumId?.trim()) {
            return customErrorResponse(400, 'albumId is required');
        }

        if (!Array.isArray(items) || items.length === 0) {
            return customErrorResponse(400, 'items array is required and cannot be empty');
        }

        // Validate items format
        for (const item of items) {
            if (!item.PK || !item.SK || item.PK !== cognitoUserId) {
                return customErrorResponse(400, 'Invalid item format or unauthorized access');
            }
        }

        // Verify album exists and belongs to user
        const albumExists = await verifyAlbumExists(cognitoUserId, albumId);
        if (!albumExists) {
            return customErrorResponse(404, 'Album not found');
        }

        // Get existing photos/videos to verify they exist
        const existingItems = await getPhotosVideos(cognitoUserId, items);
        if (existingItems.length !== items.length) {
            return customErrorResponse(400, 'Some items do not exist or are not photos/videos');
        }

        // Assign photos/videos to album
        const result = await assignPhotosToAlbum(cognitoUserId, albumId, items);

        return respond({
            message: `Assignment completed. ${result.success} items assigned successfully.`,
            success: result.success,
            failed: result.failed,
            ...(result.errors.length > 0 && { errors: result.errors }),
        });
    } catch (error) {
        console.error('Lambda execution error:', error);
        if (error instanceof SyntaxError) {
            return customErrorResponse(400, 'Invalid JSON in request body');
        }
        return internalServerErrorResponse('An unexpected error occurred while assigning photos to album');
    }
};
