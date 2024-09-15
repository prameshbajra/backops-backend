import { CognitoIdentityProvider, GetUserCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { HEADERS } from './headers';
import { Readable } from 'stream';

const cognitoClient = new CognitoIdentityProvider({ region: process.env.AWS_REGION });

export const respond = (body: unknown): APIGatewayProxyResult => ({
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify(body),
});

export const customErrorResponse = (statusCode: number, message: string): APIGatewayProxyResult => ({
    statusCode,
    headers: HEADERS,
    body: JSON.stringify({ message }),
});

export const unauthorizedResponse = (): APIGatewayProxyResult => ({
    statusCode: 401,
    headers: HEADERS,
    body: JSON.stringify({ message: 'Unauthorized' }),
});

export const internalServerErrorResponse = (err: unknown): APIGatewayProxyResult => ({
    statusCode: 500,
    headers: HEADERS,
    body: JSON.stringify({ message: 'Internal server error', error: err }),
});

export const getUserInfo = async (accessToken: string): Promise<GetUserCommandOutput | null> => {
    try {
        const userResponse = await cognitoClient.getUser({ AccessToken: accessToken });
        return userResponse;
    } catch (err) {
        console.error('Failed to get user info:', err);
        return null;
    }
};

export const validateAccessToken = (event: APIGatewayProxyEvent): string | null => {
    const accessToken = event.headers.authorization;
    return accessToken || null;
};

export const validateFileNames = (fileNames: unknown): string[] => {
    if (!Array.isArray(fileNames)) return [];
    return fileNames;
};

export const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
    const chunks: Uint8Array[] = [];
    return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
};
