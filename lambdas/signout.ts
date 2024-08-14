import { CognitoIdentityProvider, GlobalSignOutCommand } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { internalServerErrorResponse, respond, unauthorizedResponse, validateAccessToken } from './utility';

const cognitoClient = new CognitoIdentityProvider({ region: process.env.AWS_REGION });

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const accessToken = validateAccessToken(event);
    if (!accessToken) return unauthorizedResponse();

    try {
        await cognitoClient.send(new GlobalSignOutCommand({ AccessToken: accessToken }));
        return respond({ message: 'Successfully signed out.' });
    } catch (err) {
        return internalServerErrorResponse(err);
    }
};
