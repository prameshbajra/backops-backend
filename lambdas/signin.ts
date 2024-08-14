import {
    CognitoIdentityProvider,
    InitiateAuthCommandOutput,
    RespondToAuthChallengeCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyEvent, APIGatewayProxyHandler, Context } from 'aws-lambda';
import { internalServerErrorResponse, respond } from './utility';

const cognitoClient = new CognitoIdentityProvider({ region: process.env.AWS_REGION });

export const lambdaHandler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent, _context: Context) => {
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
            console.log('First time login, changing password ...');
            const challengeResponse: RespondToAuthChallengeCommandOutput = await cognitoClient.respondToAuthChallenge({
                ClientId: process.env.USER_POOL_CLIENT_ID,
                ChallengeName: 'NEW_PASSWORD_REQUIRED',
                ChallengeResponses: {
                    USERNAME: username,
                    NEW_PASSWORD: password,
                },
                Session: authResponse.Session,
            });
            return respond(challengeResponse);
        } else {
            return respond(authResponse);
        }
    } catch (err) {
        console.error(err);
        return internalServerErrorResponse(err);
    }
};
