import { DeleteItemCommand, BatchWriteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
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
}

// Helper function to delete files from an S3 bucket
const deleteFilesFromBucket = async (bucketName: string, keys: { Key: string }[]) => {
    const command = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: keys, Quiet: false },
    });
    return s3Client.send(command);
};

// Helper function to delete records from DynamoDB in batch
const deleteRecordsFromDynamoDB = async (files: FileItem[]) => {
    const deleteRequests = files.map((file) => ({
        DeleteRequest: {
            Key: marshall({ PK: file.PK, SK: file.SK }),
        },
    }));

    const batchCommand = new BatchWriteItemCommand({
        RequestItems: {
            [DYNAMODB_TABLE]: deleteRequests,
        },
    });

    return dynamoDBClient.send(batchCommand);
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

        console.log('Deleted items successfully: ', `User - ${cognitoUserId}`);

        return respond({
            message: 'Files and records deleted successfully',
            uploadFilesDeleted: uploadBucketDeleteResponse.Deleted,
            thumbnailFilesDeleted: thumbnailBucketDeleteResponse.Deleted,
        });
    } catch (error) {
        console.error('Error deleting objects or records:', error);
        return internalServerErrorResponse('Failed to delete objects or records');
    }
};
