import { AttributeValue, DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
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
                const newImage = record.dynamodb.NewImage as {
                    [key: string]: AttributeValue;
                };
                const data = unmarshall(newImage) as DynamoDBRecord;
                const { PK, SK, fileName } = data;

                console.log('Ensuring collection exists...');
                await ensureCollection(PK);

                console.log('Indexing faces...');
                const output = await indexFaces(PK, `${PK}/${fileName}`);

                console.log('Updating item with indexed faces...');
                const updateDetailsCommand = new UpdateItemCommand({
                    TableName: DYNAMODB_TABLE as string,
                    Key: {
                        PK: { S: PK },
                        SK: { S: SK },
                    },
                    UpdateExpression: 'SET #details = :details',
                    ExpressionAttributeNames: {
                        '#details': 'details',
                    },
                    ExpressionAttributeValues: {
                        ':details': {
                            M: marshall(output, {
                                removeUndefinedValues: true,
                            }),
                        },
                    },
                });
                await dynamodbClient.send(updateDetailsCommand);
                console.log('Indexed faces and updated item.');
            }
        }
    } catch (error) {
        console.error('Error processing DynamoDB stream:', error);
    }
};
