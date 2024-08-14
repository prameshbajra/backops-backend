import { CreateMultipartUploadCommand, S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APIGatewayProxyEvent, APIGatewayProxyHandler, Context } from 'aws-lambda';
import {
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from './utility';

const s3Client = new S3Client({ region: process.env.AWS_REGION, useAccelerateEndpoint: true });
const BUCKET_NAME = process.env.BUCKET_NAME as string;
const PART_SIZE = 5 * 1024 * 1024; // 5 MB

export const lambdaHandler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent, _context: Context) => {
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
    const { fileName, fileSize } = body;
    const key = `${cognitoUserId}/${fileName}`;
    const numberOfParts = Math.ceil(fileSize / PART_SIZE);

    try {
        const createMultipartUploadCommand = new CreateMultipartUploadCommand({ Bucket: BUCKET_NAME, Key: key });
        const { UploadId } = await s3Client.send(createMultipartUploadCommand);

        const presignedUrls: string[] = [];
        for (let i = 0; i < numberOfParts; i++) {
            const uploadPartCommand = new UploadPartCommand({
                Bucket: BUCKET_NAME,
                Key: key,
                UploadId,
                PartNumber: i + 1,
            });
            const presignedUrl = await getSignedUrl(s3Client, uploadPartCommand, { expiresIn: 3600 });
            presignedUrls.push(presignedUrl);
        }
        return respond({ uploadId: UploadId, presignedUrls });
    } catch (error) {
        return internalServerErrorResponse(error);
    }
};
