import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
const EXPIRY_TIME_IN_SECONDS = 24 * 60 * 60; // 24 hours

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
    const { fileName } = body;
    const key = `${cognitoUserId}/${fileName}`;

    try {
        const getObjectCommand = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        const signedUrl = await getSignedUrl(s3Client, getObjectCommand, { expiresIn: EXPIRY_TIME_IN_SECONDS });
        return respond({ signedUrl });
    } catch (error) {
        return internalServerErrorResponse(error);
    }
};
