import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { RekognitionClient, SearchFacesCommand } from '@aws-sdk/client-rekognition';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from '../utility';

const dynamoDbClient = new DynamoDBClient({});
const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION });
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;

async function updateFaceNameInDynamoDB(imageId: string, faceId: string, faceName: string) {
    const command = new UpdateItemCommand({
        TableName: DYNAMODB_TABLE,
        Key: {
            PK: { S: imageId },
            SK: { S: faceId },
        },
        UpdateExpression: 'SET faceName = :faceName',
        ExpressionAttributeValues: {
            ':faceName': { S: faceName },
        },
    });
    await dynamoDbClient.send(command);
}

async function bulkUpdateFaceNames(userId: string, faceId: string, faceName: string) {
    const command = new SearchFacesCommand({
        CollectionId: userId,
        FaceId: faceId.replace('FACE#', ''), // Remove 'FACE#' prefix if it exists
        MaxFaces: 20,
    });
    const response = await rekognitionClient.send(command);
    const matches = response.FaceMatches || [];
    for (const match of matches) {
        const matchedFace = match.Face;
        if (matchedFace?.ImageId && matchedFace.FaceId) {
            // Will need to update one by one because DynamoDB does not support batch updates ...
            // We can use promise.all if needed but I do not want to make the code too complex ...
            await updateFaceNameInDynamoDB(`IMAGE#${matchedFace.ImageId}`, `FACE#${matchedFace.FaceId}`, faceName);
        }
    }
}

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const accessToken = validateAccessToken(event);
    if (!accessToken) return unauthorizedResponse();

    const userInformation = await getUserInfo(accessToken);
    if (!userInformation) return internalServerErrorResponse('Failed to get user info');

    const userId = userInformation.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;
    console.log('User ID:', userId);

    const body = JSON.parse(event.body || '{}');
    const { imageId, faceId, faceName } = body;

    if (!userId || !imageId || !faceId || !faceName) {
        return internalServerErrorResponse('UserId, imageId, faceId, and faceName must be provided');
    }

    try {
        await updateFaceNameInDynamoDB(imageId, faceId, faceName);
        await bulkUpdateFaceNames(userId, faceId, faceName);
        return respond({ message: 'Face name updated successfully' });
    } catch (error) {
        console.error('Error querying items from DynamoDB:', error);
        return internalServerErrorResponse('Failed to query items from DynamoDB');
    }
};
