import { CompleteMultipartUploadCommand, S3Client } from '@aws-sdk/client-s3';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    validateAccessToken,
    unauthorizedResponse,
    getUserInfo,
    internalServerErrorResponse,
    customErrorResponse,
    respond,
} from './utility';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

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

    const bucketName = process.env.BUCKET_NAME as string;
    const { uploadId, key, parts } = JSON.parse(event.body || '{}');

    if (!uploadId || !key || !parts) {
        return customErrorResponse(400, 'Missing required parameters');
    }

    const params = {
        Bucket: bucketName,
        Key: `${cognitoUserId}/${key}`,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
    };

    try {
        const command = new CompleteMultipartUploadCommand(params);
        const data = await s3Client.send(command);
        return respond(data);
    } catch (error) {
        return internalServerErrorResponse(error);
    }
};
