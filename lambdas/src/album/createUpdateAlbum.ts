import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
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

const checkAlbumNameExists = async (userId: string, albumName: string, excludeAlbumId?: string) => {
    const params = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'PK = :userId AND begins_with(SK, :albumPrefix)',
        ExpressionAttributeValues: marshall({
            ':userId': userId,
            ':albumPrefix': 'ALBUM#',
        }),
    };

    const result = await dynamoDbClient.send(new QueryCommand(params));
    if (!result.Items) return false;

    const existing = result.Items.find((item) => {
        const album = unmarshall(item);
        if (excludeAlbumId && album.SK === excludeAlbumId) return false;
        return album.albumName?.toLowerCase() === albumName.toLowerCase();
    });

    return !!existing;
};

const getAlbum = async (userId: string, albumId: string) => {
    const res = await dynamoDbClient.send(
        new GetItemCommand({
            TableName: DYNAMODB_TABLE,
            Key: marshall({ PK: userId, SK: albumId }),
        }),
    );
    return res.Item ? unmarshall(res.Item) : undefined;
};

const saveOrUpdateAlbum = async (userId: string, albumId: string, albumName: string, isNewAlbum: boolean) => {
    const now = new Date().toISOString();
    let createdAt: string | undefined = undefined;

    if (!isNewAlbum) {
        const existing = await getAlbum(userId, albumId);
        if (!existing) return { error: 'NOT_FOUND' as const };
        createdAt = existing.createdAt || existing.updatedAt || now;
    }

    const item = {
        PK: userId,
        SK: albumId.startsWith('ALBUM#') ? albumId : `ALBUM#${albumId}`,
        albumName,
        updatedAt: now,
        ...(isNewAlbum ? { createdAt: now } : createdAt ? { createdAt } : {}),
    };

    await dynamoDbClient.send(
        new PutItemCommand({
            TableName: DYNAMODB_TABLE,
            Item: marshall(item),
        }),
    );

    return { item };
};

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    try {
        const accessToken = validateAccessToken(event);
        if (!accessToken) return unauthorizedResponse();

        const userResponse = await getUserInfo(accessToken);
        if (!userResponse) return internalServerErrorResponse('Failed to get user info');

        const cognitoUserId = userResponse.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;
        if (!cognitoUserId) return unauthorizedResponse();

        const body = JSON.parse(event.body || '{}');
        const { albumId, albumName } = body;

        if (!albumName?.trim()) {
            return customErrorResponse(400, 'albumName is required and cannot be empty');
        }

        const trimmedAlbumName = albumName.trim();
        const isNewAlbum = !albumId;
        const finalAlbumId = albumId || randomUUID();

        const albumNameExists = await checkAlbumNameExists(
            cognitoUserId,
            trimmedAlbumName,
            isNewAlbum ? undefined : finalAlbumId,
        );
        if (albumNameExists) {
            return customErrorResponse(409, 'An album with this name already exists');
        }

        const saved = await saveOrUpdateAlbum(cognitoUserId, finalAlbumId, trimmedAlbumName, isNewAlbum);
        if (saved.error === 'NOT_FOUND') {
            return customErrorResponse(404, 'Album not found');
        }

        const savedAlbum = saved.item;

        return respond({
            albumId: savedAlbum.SK,
            albumName: savedAlbum.albumName,
            message: isNewAlbum ? 'Album created successfully' : 'Album updated successfully',
            ...(isNewAlbum && { createdAt: savedAlbum.createdAt }),
            updatedAt: savedAlbum.updatedAt,
        });
    } catch (error) {
        if (error instanceof SyntaxError) {
            return customErrorResponse(400, 'Invalid JSON in request body');
        }
        return internalServerErrorResponse('An unexpected error occurred.');
    }
};
