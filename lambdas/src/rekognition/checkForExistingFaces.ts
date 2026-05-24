import {
    AttributeValue,
    DynamoDBClient,
    GetItemCommand,
    QueryCommand,
    TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb';
import { RekognitionClient, SearchFacesCommand } from '@aws-sdk/client-rekognition';
import { marshall } from '@aws-sdk/util-dynamodb';
import { Context, DynamoDBStreamEvent } from 'aws-lambda';

const dynamoDbClient = new DynamoDBClient({});
const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION });
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;

interface FaceRow {
    faceId: string;
    boundingBox?: Record<string, unknown>;
    confidence?: number;
}

const promoteFaceToNamed = async (
    userId: string,
    imageId: string,
    face: FaceRow,
    faceName: string,
    originalSK: string,
    fileName: string,
) => {
    const nowIso = new Date().toISOString();
    const command = new TransactWriteItemsCommand({
        TransactItems: [
            {
                Delete: {
                    TableName: DYNAMODB_TABLE,
                    Key: {
                        PK: { S: userId },
                        SK: { S: `PERSON#__UNNAMED__#${face.faceId}` },
                    },
                },
            },
            {
                Put: {
                    TableName: DYNAMODB_TABLE,
                    Item: marshall(
                        {
                            PK: userId,
                            SK: `PERSON#${faceName}#${face.faceId}`,
                            faceName,
                            faceId: face.faceId,
                            imageId,
                            originalSK,
                            fileName,
                            boundingBox: face.boundingBox,
                            confidence: face.confidence,
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
                        PK: { S: `IMAGE#${imageId}` },
                        SK: { S: `FACE#${face.faceId}` },
                    },
                    UpdateExpression: 'SET #faceName = :faceName, #updatedAt = :updatedAt',
                    ExpressionAttributeNames: {
                        '#faceName': 'faceName',
                        '#updatedAt': 'updatedAt',
                    },
                    ExpressionAttributeValues: {
                        ':faceName': { S: faceName },
                        ':updatedAt': { S: nowIso },
                    },
                },
            },
        ],
    });
    console.log(`Promoting faceId ${face.faceId} on imageId ${imageId} to name "${faceName}"`);
    await dynamoDbClient.send(command);
};

const getFaceNameFromImageIdAndFaceId = async (imageId: string, faceId: string): Promise<string> => {
    const command = new GetItemCommand({
        TableName: DYNAMODB_TABLE,
        Key: {
            PK: { S: `IMAGE#${imageId}` },
            SK: { S: `FACE#${faceId}` },
        },
        ProjectionExpression: 'faceName',
    });

    try {
        const result = await dynamoDbClient.send(command);
        const faceName = result.Item?.faceName?.S;
        if (!faceName) {
            throw new Error(`faceName not found for imageId=${imageId} faceId=${faceId}`);
        }
        return faceName;
    } catch (error) {
        console.error(`Error fetching faceName for imageId=${imageId} faceId=${faceId}:`, error);
        throw error;
    }
};

const searchFaceMatches = async (collectionId: string, faceId: string) => {
    const command = new SearchFacesCommand({
        CollectionId: collectionId,
        FaceId: faceId,
        MaxFaces: 5,
    });
    const response = await rekognitionClient.send(command);
    return response.FaceMatches || [];
};

const unmarshallBoundingBox = (raw?: AttributeValue): Record<string, unknown> | undefined => {
    if (!raw?.M) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw.M)) {
        if (value?.N !== undefined) {
            out[key] = Number(value.N);
        } else if (value?.S !== undefined) {
            out[key] = value.S;
        }
    }
    return out;
};

const getFaceRecordsByImageId = async (imageId: string): Promise<FaceRow[]> => {
    const params = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
            ':pk': { S: `IMAGE#${imageId}` },
        },
    };

    const result = await dynamoDbClient.send(new QueryCommand(params));
    const rows: FaceRow[] = (result.Items ?? [])
        .map((item) => {
            const faceId = item.SK?.S?.startsWith('FACE#') ? item.SK.S.slice('FACE#'.length) : undefined;
            if (!faceId) return null;
            const confidenceRaw = item.confidence?.N;
            return {
                faceId,
                boundingBox: unmarshallBoundingBox(item.boundingBox),
                confidence: confidenceRaw !== undefined ? Number(confidenceRaw) : undefined,
            } as FaceRow;
        })
        .filter((row): row is FaceRow => row !== null);

    return rows;
};
export const lambdaHandler = async (event: DynamoDBStreamEvent, _context: Context): Promise<void> => {
    for (const record of event.Records) {
        if (record.eventName === 'MODIFY' && record.dynamodb?.NewImage) {
            const newData = record.dynamodb.NewImage;
            const imageId = newData.imageId?.S;
            const collectionId = newData.PK?.S;
            const originalSK = newData.SK?.S;
            const fileName = newData.fileName?.S;

            if (!collectionId || !imageId || !originalSK || !fileName) {
                console.warn(`Skipping record with missing required fields: ${JSON.stringify(newData)}`);
                return;
            }

            const faces = await getFaceRecordsByImageId(imageId);

            for (const face of faces) {
                const matches = await searchFaceMatches(collectionId, face.faceId);
                const topMatch = matches[0];
                console.log(`Found match for faceId ${face.faceId}. topMatch: ${JSON.stringify(topMatch)}`);
                if (topMatch) {
                    const matchedImageId = topMatch.Face?.ImageId;
                    const matchedFaceId = topMatch.Face?.FaceId;
                    if (!matchedImageId || !matchedFaceId) {
                        console.warn(
                            `Skipping match with missing matchedImageId or matchedFaceId: ${JSON.stringify(topMatch)}`,
                        );
                        continue;
                    }
                    const faceName = await getFaceNameFromImageIdAndFaceId(matchedImageId, matchedFaceId);
                    await promoteFaceToNamed(collectionId, imageId, face, faceName, originalSK, fileName);
                }
            }

            console.log(`Processed imageId ${imageId} with ${faces.length} faces.`);
        }
    }
};
