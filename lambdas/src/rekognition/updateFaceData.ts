import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { RekognitionClient, SearchFacesCommand } from '@aws-sdk/client-rekognition';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from '../utility';

const dynamoDbClient = new DynamoDBClient({});
const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION });
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;
const UNNAMED = '__UNNAMED__';

const stripPrefix = (value: string, prefix: string): string =>
    value.startsWith(prefix) ? value.slice(prefix.length) : value;

interface FaceRowSnapshot {
    faceName?: string;
    boundingBox?: Record<string, unknown>;
    confidence?: number;
}

const getFaceRow = async (imageIdRaw: string, faceIdRaw: string): Promise<FaceRowSnapshot | null> => {
    const result = await dynamoDbClient.send(
        new GetItemCommand({
            TableName: DYNAMODB_TABLE,
            Key: {
                PK: { S: `IMAGE#${imageIdRaw}` },
                SK: { S: `FACE#${faceIdRaw}` },
            },
            ProjectionExpression: 'faceName, boundingBox, confidence',
        }),
    );
    if (!result.Item) return null;
    const item = unmarshall(result.Item) as FaceRowSnapshot;
    return item;
};

interface PersonRowSnapshot {
    originalSK?: string;
    fileName?: string;
    boundingBox?: Record<string, unknown>;
    confidence?: number;
}

const getPersonRow = async (
    userId: string,
    oldName: string,
    faceIdRaw: string,
): Promise<PersonRowSnapshot | null> => {
    const result = await dynamoDbClient.send(
        new GetItemCommand({
            TableName: DYNAMODB_TABLE,
            Key: {
                PK: { S: userId },
                SK: { S: `PERSON#${oldName}#${faceIdRaw}` },
            },
            ProjectionExpression: 'originalSK, fileName, boundingBox, confidence',
        }),
    );
    if (!result.Item) return null;
    return unmarshall(result.Item) as PersonRowSnapshot;
};

const renameOnePerson = async (
    userId: string,
    imageIdRaw: string,
    faceIdRaw: string,
    newName: string,
): Promise<void> => {
    const faceRow = await getFaceRow(imageIdRaw, faceIdRaw);
    if (!faceRow) {
        console.warn(`FACE row missing for imageId=${imageIdRaw} faceId=${faceIdRaw}; skipping.`);
        return;
    }
    const oldName = faceRow.faceName && faceRow.faceName.trim() !== '' ? faceRow.faceName : UNNAMED;
    if (oldName === newName) {
        console.log(`Skipping rename for faceId=${faceIdRaw}: already named "${newName}".`);
        return;
    }

    const personRow = await getPersonRow(userId, oldName, faceIdRaw);
    const boundingBox = personRow?.boundingBox ?? faceRow.boundingBox;
    const confidence = personRow?.confidence ?? faceRow.confidence;
    const originalSK = personRow?.originalSK;
    const fileName = personRow?.fileName;

    const nowIso = new Date().toISOString();
    const command = new TransactWriteItemsCommand({
        TransactItems: [
            {
                Delete: {
                    TableName: DYNAMODB_TABLE,
                    Key: {
                        PK: { S: userId },
                        SK: { S: `PERSON#${oldName}#${faceIdRaw}` },
                    },
                },
            },
            {
                Put: {
                    TableName: DYNAMODB_TABLE,
                    Item: marshall(
                        {
                            PK: userId,
                            SK: `PERSON#${newName}#${faceIdRaw}`,
                            faceName: newName,
                            faceId: faceIdRaw,
                            imageId: imageIdRaw,
                            originalSK,
                            fileName,
                            boundingBox,
                            confidence,
                            updatedAt: nowIso,
                        },
                        { removeUndefinedValues: true },
                    ),
                },
            },
            {
                Update: {
                    TableName: DYNAMODB_TABLE,
                    Key: {
                        PK: { S: `IMAGE#${imageIdRaw}` },
                        SK: { S: `FACE#${faceIdRaw}` },
                    },
                    UpdateExpression: 'SET #faceName = :faceName, #updatedAt = :updatedAt',
                    ExpressionAttributeNames: {
                        '#faceName': 'faceName',
                        '#updatedAt': 'updatedAt',
                    },
                    ExpressionAttributeValues: {
                        ':faceName': { S: newName },
                        ':updatedAt': { S: nowIso },
                    },
                },
            },
        ],
    });
    console.log(`Renaming faceId=${faceIdRaw} on imageId=${imageIdRaw}: "${oldName}" -> "${newName}"`);
    await dynamoDbClient.send(command);
};

const bulkRenameSimilarFaces = async (userId: string, faceIdRaw: string, newName: string): Promise<void> => {
    const response = await rekognitionClient.send(
        new SearchFacesCommand({
            CollectionId: userId,
            FaceId: faceIdRaw,
            MaxFaces: 20,
        }),
    );
    const matches = response.FaceMatches || [];
    for (const match of matches) {
        const matchedImageId = match.Face?.ImageId;
        const matchedFaceId = match.Face?.FaceId;
        if (!matchedImageId || !matchedFaceId) continue;
        try {
            await renameOnePerson(userId, matchedImageId, matchedFaceId, newName);
        } catch (error) {
            console.error(
                `Failed to rename matched faceId=${matchedFaceId} imageId=${matchedImageId}:`,
                error,
            );
        }
    }
};

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const accessToken = validateAccessToken(event);
    if (!accessToken) return unauthorizedResponse();

    const userInformation = await getUserInfo(accessToken);
    if (!userInformation) return internalServerErrorResponse('Failed to get user info');

    const userId = userInformation.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;
    console.log('User ID:', userId);

    const body = JSON.parse(event.body || '{}');
    const { imageId, faceId, faceName } = body;

    if (!userId || !imageId || !faceId || !faceName) {
        return internalServerErrorResponse('UserId, imageId, faceId, and faceName must be provided');
    }

    const imageIdRaw = stripPrefix(imageId, 'IMAGE#');
    const faceIdRaw = stripPrefix(faceId, 'FACE#');

    try {
        await renameOnePerson(userId, imageIdRaw, faceIdRaw, faceName);
        await bulkRenameSimilarFaces(userId, faceIdRaw, faceName);
        return respond({ message: 'Face name updated successfully' });
    } catch (error) {
        console.error('Error updating face name:', error);
        return internalServerErrorResponse('Failed to update face name');
    }
};
