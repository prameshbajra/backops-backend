import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from '../utility';

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;
const dynamoDbClient = new DynamoDBClient({});

interface Album {
    albumId: string;
    albumName: string;
    createdAt?: string;
    updatedAt: string;
}

const getUserAlbums = async (userId: string): Promise<Album[]> => {
    const params = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
            ':pk': { S: userId },
            ':skPrefix': { S: 'ALBUM#' },
        },
        // Optional: Add sorting by creation date (newest first)
        ScanIndexForward: false,
    };

    try {
        console.log('Querying albums for user:', userId);
        const command = new QueryCommand(params);
        const result = await dynamoDbClient.send(command);

        if (!result.Items || result.Items.length === 0) {
            console.log('No albums found for user');
            return [];
        }

        const albums: Album[] = result.Items.map((item) => {
            const unmarshalled = unmarshall(item);
            return {
                albumId: unmarshalled.SK,
                albumName: unmarshalled.albumName,
                ...(unmarshalled.createdAt && { createdAt: unmarshalled.createdAt }),
                updatedAt: unmarshalled.updatedAt,
            };
        });

        console.log(`Found ${albums.length} albums for user`);
        return albums;
    } catch (error) {
        console.error('Error querying albums:', error);
        throw error;
    }
};

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    try {
        const accessToken = validateAccessToken(event);
        if (!accessToken) return unauthorizedResponse();

        const userResponse = await getUserInfo(accessToken);
        if (!userResponse) return internalServerErrorResponse('Failed to get user info');

        const cognitoUserId = userResponse.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;
        if (!cognitoUserId) {
            console.warn('Cannot find user.');
            return unauthorizedResponse();
        }

        const albums = await getUserAlbums(cognitoUserId);
        return respond({ albums });
    } catch (error) {
        console.error('Lambda execution error:', error);
        return internalServerErrorResponse('An unexpected error occurred while fetching albums');
    }
};
