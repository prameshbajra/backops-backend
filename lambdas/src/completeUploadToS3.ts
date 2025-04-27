import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { CompleteMultipartUploadCommand, S3Client } from '@aws-sdk/client-s3';
import { marshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    customErrorResponse,
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from './utility';

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;
const dynamoDbClient = new DynamoDBClient({});
const s3Client = new S3Client({ region: process.env.AWS_REGION });

const saveDataToDynamoDb = async (userId: string, fileName: string, size: number) => {
    const currentDate = new Date().toISOString();
    const item = {
        PK: userId,
        SK: currentDate,
        fileName: fileName,
        fileSize: size,
    };
    console.log('Item to be inserted into DynamoDB:', item);

    const params = {
        TableName: DYNAMODB_TABLE,
        Item: marshall(item),
    };

    try {
        const command = new PutItemCommand(params);
        await dynamoDbClient.send(command);
        console.log('Data successfully inserted into DynamoDB');
    } catch (error) {
        console.error('Error inserting data into DynamoDB:', error);
    }
};

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const accessToken = validateAccessToken(event);
    if (!accessToken) return unauthorizedResponse();

    const userResponse = await getUserInfo(accessToken);
    if (!userResponse) return internalServerErrorResponse('Failed to get user info');

    const cognitoUserId = userResponse.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;
    if (!cognitoUserId) {
        console.warn('Cannot find user.');
        return unauthorizedResponse();
    }

    const bucketName = process.env.BUCKET_NAME as string;
    const { uploadId, fileName, fileSize, parts } = JSON.parse(event.body || '{}');

    if (!uploadId || !fileName || !parts) {
        return customErrorResponse(400, 'Missing required parameters');
    }

    const params = {
        Bucket: bucketName,
        Key: `${cognitoUserId}/${fileName}`,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
    };

    try {
        const command = new CompleteMultipartUploadCommand(params);
        const data = await s3Client.send(command);
        await saveDataToDynamoDb(cognitoUserId, fileName, fileSize);
        return respond(data);
    } catch (error) {
        return internalServerErrorResponse(error);
    }
};
