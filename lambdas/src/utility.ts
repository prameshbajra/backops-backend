import {
    CognitoIdentityProvider,
    GetUserCommandOutput,
    TooManyRequestsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { HEADERS } from './headers';

const cognitoClient = new CognitoIdentityProvider({ region: process.env.AWS_REGION });

export const respond = (body: unknown, statusCode = 200): APIGatewayProxyResult => ({
    statusCode: statusCode,
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

export const getUserInfo = async (accessToken: string, retryCount = 5): Promise<GetUserCommandOutput | null> => {
    try {
        const userResponse = await cognitoClient.getUser({ AccessToken: accessToken });
        return userResponse;
    } catch (err) {
        if (err instanceof TooManyRequestsException && retryCount > 0) {
            console.warn('TooManyRequestsException: Retrying...', retryCount);
            await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, 3 - retryCount)));
            return getUserInfo(accessToken, retryCount - 1);
        }
        console.error('Failed to get user info:', err);
        return null;
    }
};

export const validateAccessToken = (event: APIGatewayProxyEvent): string | null => {
    const accessToken = event.headers.authorization;
    return accessToken || null;
};
