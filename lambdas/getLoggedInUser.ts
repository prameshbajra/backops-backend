import { CognitoIdentityProvider, GetUserCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { HEADERS } from './headers';

const cognitoClient = new CognitoIdentityProvider({ region: process.env.AWS_REGION });

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const accessToken = event.headers.authorization;
    if (!accessToken) {
        return {
            statusCode: 401,
            headers: HEADERS,
            body: JSON.stringify({ message: 'Unauthorized' }),
        };
    }
    try {
        const userResponse: GetUserCommandOutput = await cognitoClient.getUser({
            AccessToken: accessToken,
        });

        return {
            statusCode: 200,
            headers: HEADERS,
            body: JSON.stringify(userResponse),
        };
    } catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            headers: HEADERS,
            body: JSON.stringify({ message: 'Internal server error', error: err }),
        };
    }
};
