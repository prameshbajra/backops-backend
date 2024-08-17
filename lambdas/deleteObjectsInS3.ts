import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
    validateFileNames,
} from './utility';

const s3Client = new S3Client({ region: process.env.AWS_REGION, useAccelerateEndpoint: true });
const BUCKET_NAME = process.env.BUCKET_NAME as string;

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
    const { fileNames } = body;
    const validatedFileNames = validateFileNames(fileNames);

    console.log('Files to be deleted: ', validatedFileNames);
    try {
        const deleteCommand = new DeleteObjectsCommand({
            Bucket: BUCKET_NAME,
            Delete: {
                Objects: validatedFileNames.map((name: string) => ({ Key: `${cognitoUserId}/${name}` })),
                Quiet: false,
            },
        });
        const deleteResponse = await s3Client.send(deleteCommand);
        return respond(deleteResponse.Deleted);
    } catch (error) {
        console.error('Error listing S3 objects:', error);
        return internalServerErrorResponse('Failed to list S3 objects');
    }
};
