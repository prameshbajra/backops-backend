import { CognitoIdentityProvider, InitiateAuthCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyHandler } from 'aws-lambda';

const cognitoClient = new CognitoIdentityProvider({ region: process.env.AWS_REGION });

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const body = JSON.parse(event.body || '{}');
    const { username, password } = body;

    try {
        const response: InitiateAuthCommandOutput = await cognitoClient.initiateAuth({
            ClientId: process.env.USER_POOL_CLIENT_ID,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password,
            },
        });
        console.log(response);
        return {
            statusCode: 200,
            body: JSON.stringify(response),
        };
    } catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            body: JSON.stringify(err),
        };
    }
};
