import { DynamoDBClient, GetItemCommand, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { RekognitionClient, SearchFacesCommand } from '@aws-sdk/client-rekognition';
import { Context, DynamoDBStreamEvent } from 'aws-lambda';

const dynamoDbClient = new DynamoDBClient({});
const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION });
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;

const updateFaceName = async (imageId: string, faceId: string, faceName: string) => {
    const command = new UpdateItemCommand({
        TableName: DYNAMODB_TABLE,
        Key: {
            PK: { S: `IMAGE#${imageId}` },
            SK: { S: `FACE#${faceId}` },
        },
        UpdateExpression: 'SET #faceName = :faceName, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
            '#faceName': 'faceName',
            '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
            ':faceName': { S: faceName },
            ':updatedAt': { S: new Date().toISOString() },
        },
    });
    console.log(`Updating face name for imageId ${imageId}, faceId ${faceId} to ${faceName}`);
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

const getFaceRecordsByImageId = async (imageId: string): Promise<string[]> => {
    const params = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
            ':pk': { S: `IMAGE#${imageId}` },
        },
    };

    const result = await dynamoDbClient.send(new QueryCommand(params));
    const faceIds: string[] = (result.Items ?? [])
        .map((item) => item.SK?.S?.replace('FACE#', ''))
        .filter((id): id is string => typeof id === 'string');

    return faceIds;
};
export const lambdaHandler = async (event: DynamoDBStreamEvent, _context: Context): Promise<void> => {
    for (const record of event.Records) {
        if (record.eventName === 'MODIFY' && record.dynamodb?.NewImage) {
            const newData = record.dynamodb.NewImage;
            const imageId = newData.imageId.S;
            const collectionId = newData.PK.S;

            if (!collectionId || !imageId) {
                console.warn(`Skipping record with missing collectionId or imageId: ${JSON.stringify(newData)}`);
                return;
            }

            const faceIds = await getFaceRecordsByImageId(imageId);

            for (const faceId of faceIds) {
                const matches = await searchFaceMatches(collectionId, faceId);
                const topMatch = matches[0];
                console.log(`Found match for faceId ${faceId}. topMatch: ${JSON.stringify(topMatch)}`);
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
                    await updateFaceName(imageId, faceId, faceName);
                }
            }

            console.log(`Processed imageId ${imageId} with ${faceIds.length} faces.`);
        }
    }
};
