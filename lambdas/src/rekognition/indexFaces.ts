import { AttributeValue, BatchWriteItemCommand, DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import {
    Attribute,
    CreateCollectionCommand,
    DescribeCollectionCommand,
    IndexFacesCommand,
    IndexFacesCommandOutput,
    RekognitionClient,
    RekognitionServiceException,
} from '@aws-sdk/client-rekognition';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Context, DynamoDBStreamEvent } from 'aws-lambda';

const UPLOAD_BUCKET_NAME = process.env.UPLOAD_BUCKET_NAME as string;
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;
const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION });
const dynamodbClient = new DynamoDBClient({});

interface DynamoDBRecord {
    fileName: string;
    fileSize: number;
    PK: string;
    SK: string;
    details: unknown;
}

async function ensureCollection(collectionId: string): Promise<void> {
    try {
        await rekognitionClient.send(new DescribeCollectionCommand({ CollectionId: collectionId }));
        console.log(`Collection "${collectionId}" exists already.`);
    } catch (error: unknown) {
        if (error instanceof RekognitionServiceException) {
            if (error.name === 'ResourceNotFoundException') {
                console.log(`Collection "${collectionId}" not found, creating...`);
                await rekognitionClient.send(
                    new CreateCollectionCommand({
                        CollectionId: collectionId,
                    }),
                );
                console.log(`Collection "${collectionId}" created.`);
            } else {
                throw error;
            }
        } else {
            throw error;
        }
    }
}

async function indexFaces(collectionID: string, s3PathForObject: string): Promise<IndexFacesCommandOutput> {
    console.log(`Indexing faces for collection "${collectionID}"...`);
    console.log(`Bucket Name: ${UPLOAD_BUCKET_NAME}`);
    console.log(`S3 Path: ${s3PathForObject}`);
    const indexFacesCommand = new IndexFacesCommand({
        CollectionId: collectionID,
        Image: {
            S3Object: {
                Bucket: UPLOAD_BUCKET_NAME,
                Name: s3PathForObject,
            },
        },
        DetectionAttributes: [Attribute.DEFAULT],
        MaxFaces: 10,
    });
    const indexFacesResponse = await rekognitionClient.send(indexFacesCommand);
    return indexFacesResponse;
}

export const lambdaHandler = async (event: DynamoDBStreamEvent, _context: Context): Promise<void> => {
    try {
        for (const record of event.Records) {
            if (record.dynamodb?.NewImage) {
                const newImage = record.dynamodb.NewImage as { [key: string]: AttributeValue };
                const data = unmarshall(newImage) as DynamoDBRecord;
                const { PK, SK, fileName } = data;

                console.log('Ensuring collection exists...');
                await ensureCollection(PK);

                console.log('Indexing faces...');
                const output = await indexFaces(PK, `${PK}/${fileName}`);

                let imageId: string | undefined = '';
                const putRequests = (output.FaceRecords || [])
                    .map((faceRecord) => {
                        const boundingBox = faceRecord.Face?.BoundingBox;
                        const faceId = faceRecord.Face?.FaceId;
                        imageId = faceRecord.Face?.ImageId;
                        const confidence = faceRecord.Face?.Confidence;

                        if (!faceId || !imageId) return null;

                        return {
                            PutRequest: {
                                Item: marshall({
                                    PK: `IMAGE#${imageId}`,
                                    SK: `FACE#${faceId}`,
                                    boundingBox,
                                    confidence,
                                    updatedAt: new Date().toISOString(),
                                }),
                            },
                        };
                    })
                    .filter((item): item is { PutRequest: { Item: Record<string, AttributeValue> } } => !!item);

                // DynamoDB allows max 25 items per batch
                const BATCH_SIZE = 25;
                for (let i = 0; i < putRequests.length; i += BATCH_SIZE) {
                    const batch = putRequests.slice(i, i + BATCH_SIZE);
                    console.log(`Inserting ${batch.length} records into DynamoDB...`);
                    const params = {
                        RequestItems: {
                            [DYNAMODB_TABLE]: batch,
                        },
                    };
                    await dynamodbClient.send(new BatchWriteItemCommand(params));
                }
                console.log(`Successfully inserted ${putRequests.length} records into DynamoDB.`);
                if (imageId && imageId.trim() !== '') {
                    console.log(`Updating imageId : ${imageId} in PK: ${PK} SK: ${SK}`);
                    const updateDetailsCommand = new UpdateItemCommand({
                        TableName: DYNAMODB_TABLE,
                        Key: {
                            PK: { S: PK },
                            SK: { S: SK },
                        },
                        UpdateExpression: 'SET #imageId = :imageId, #updatedAt = :updatedAt',
                        ExpressionAttributeNames: {
                            '#imageId': 'imageId',
                            '#updatedAt': 'updatedAt',
                        },
                        ExpressionAttributeValues: {
                            ':imageId': { S: imageId },
                            ':updatedAt': { S: new Date().toISOString() },
                        },
                    });
                    await dynamodbClient.send(updateDetailsCommand);
                    console.log(
                        `Item updated with imageId: ${imageId}. This update will trigger checkForExistingFaces lambda function as well.`,
                    );
                } else {
                    console.log('No valid imageId found. Skipping item update.');
                }
            }
        }
    } catch (error) {
        console.error('Error processing DynamoDB stream:', error);
    }
};
