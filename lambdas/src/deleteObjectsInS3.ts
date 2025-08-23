import { BatchWriteItemCommand, DynamoDBClient, QueryCommand, WriteRequest } from '@aws-sdk/client-dynamodb';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { marshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    chunkArray,
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from './utility';

const s3Client = new S3Client({ region: process.env.AWS_REGION, useAccelerateEndpoint: true });
const dynamoDBClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const UPLOAD_BUCKET_NAME = process.env.UPLOAD_BUCKET_NAME as string;
const THUMBNAIL_BUCKET_NAME = process.env.THUMBNAIL_BUCKET_NAME as string;
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;

interface FileItem {
    PK: string;
    SK: string;
    fileName: string;
    imageId?: string;
}

const deleteFilesFromBucket = async (bucketName: string, keys: { Key: string }[]) => {
    const command = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: keys, Quiet: false },
    });
    return s3Client.send(command);
};

const deleteRecordsFromDynamoDB = async (files: FileItem[]) => {
    const deleteRequests = files.map((file) => ({
        DeleteRequest: {
            Key: marshall({ PK: file.PK, SK: file.SK }),
        },
    }));

    const chunks = chunkArray(deleteRequests, 25);

    for (const chunk of chunks) {
        const batchCommand = new BatchWriteItemCommand({
            RequestItems: {
                [DYNAMODB_TABLE]: chunk,
            },
        });

        const response = await dynamoDBClient.send(batchCommand);

        if (response.UnprocessedItems && Object.keys(response.UnprocessedItems).length > 0) {
            console.warn('Some items were not processed:', response.UnprocessedItems);
            throw new Error('Failed to delete some items from DynamoDB');
        }
    }
};

const deleteDanglingImageIds = async (files: FileItem[]) => {
    const imageIds = files.map((file) => file.imageId).filter((id): id is string => id !== undefined);
    if (imageIds.length === 0) {
        console.log('No image IDs to delete');
        return;
    }
    console.log('Deleting these imageIds: ', imageIds);

    try {
        const allItemsToDelete: WriteRequest[] = [];

        // Because we cannot just delete using only PK, we have to query them all and then delete them in batch ...
        for (const imageId of imageIds) {
            const queryCommand = new QueryCommand({
                TableName: DYNAMODB_TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
                ExpressionAttributeValues: marshall({
                    ':pk': `IMAGE#${imageId}`,
                    ':skPrefix': 'FACE#',
                }),
            });

            const queryResult = await dynamoDBClient.send(queryCommand);

            if (queryResult.Items) {
                queryResult.Items.forEach((item) => {
                    allItemsToDelete.push({
                        DeleteRequest: {
                            Key: {
                                PK: item.PK,
                                SK: item.SK,
                            },
                        },
                    });
                });
            }
        }

        if (allItemsToDelete.length === 0) {
            console.log('No face records found to delete');
            return;
        }

        const chunks = chunkArray(allItemsToDelete, 25);
        
        for (const chunk of chunks) {
            const batchCommand = new BatchWriteItemCommand({
                RequestItems: {
                    [DYNAMODB_TABLE]: chunk,
                },
            });

            const response = await dynamoDBClient.send(batchCommand);
            
            if (response.UnprocessedItems && Object.keys(response.UnprocessedItems).length > 0) {
                console.warn('Some face records were not processed:', response.UnprocessedItems);
                throw new Error('Failed to delete some face records from DynamoDB');
            }
        }
        
        console.log(`Successfully deleted ${allItemsToDelete.length} face records for ${imageIds.length} images`);
    } catch (error) {
        console.error('Error deleting dangling image IDs:', error);
        throw error;
    }
};

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const accessToken = validateAccessToken(event);
    if (!accessToken) return unauthorizedResponse();

    const userResponse = await getUserInfo(accessToken);
    if (!userResponse) return internalServerErrorResponse('Failed to get user info');

    const cognitoUserId = userResponse.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;
    if (!cognitoUserId) {
        console.warn('Cannot find user.');
        return unauthorizedResponse();
    }

    const body = JSON.parse(event.body || '{}');
    const { files } = body;
    const fileKeys = files.map((file: FileItem) => ({ Key: `${cognitoUserId}/${file.fileName}` }));

    try {
        // Perform S3 deletions in parallel
        const [uploadBucketDeleteResponse, thumbnailBucketDeleteResponse] = await Promise.all([
            deleteFilesFromBucket(UPLOAD_BUCKET_NAME, fileKeys),
            deleteFilesFromBucket(THUMBNAIL_BUCKET_NAME, fileKeys),
        ]);

        // Perform DynamoDB deletions
        await deleteRecordsFromDynamoDB(files);
        await deleteDanglingImageIds(files);

        console.log('Deleted items successfully: ', `User - ${cognitoUserId}`);

        return respond({
            message: 'Files and records deleted successfully',
            uploadFilesDeleted: uploadBucketDeleteResponse.Deleted,
            thumbnailFilesDeleted: thumbnailBucketDeleteResponse.Deleted,
        });
    } catch (error) {
        return internalServerErrorResponse('Failed to delete objects or records');
    }
};
