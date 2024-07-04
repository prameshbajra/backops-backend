import {
    CognitoIdentityProvider,
    InitiateAuthCommandOutput,
    RespondToAuthChallengeCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyHandler } from 'aws-lambda';

const cognitoClient = new CognitoIdentityProvider({ region: process.env.AWS_REGION });

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const body = JSON.parse(event.body || '{}');
    const { username, password } = body;

    try {
        const authResponse: InitiateAuthCommandOutput = await cognitoClient.initiateAuth({
            ClientId: process.env.USER_POOL_CLIENT_ID,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password,
            },
        });

        if (authResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
            const challengeResponse: RespondToAuthChallengeCommandOutput = await cognitoClient.respondToAuthChallenge({
                ClientId: process.env.USER_POOL_CLIENT_ID,
                ChallengeName: 'NEW_PASSWORD_REQUIRED',
                ChallengeResponses: {
                    USERNAME: username,
                    NEW_PASSWORD: password,
                },
                Session: authResponse.Session,
            });

            console.log(challengeResponse);
            return {
                statusCode: 200,
                body: JSON.stringify(challengeResponse),
            };
        } else {
            console.log(authResponse);
            return {
                statusCode: 200,
                body: JSON.stringify(authResponse),
            };
        }
    } catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            body: JSON.stringify(err),
        };
    }
};
