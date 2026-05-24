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

const saveDataToDynamoDb = async (userId: string, fileName: string, size: number, imageMetadata?: any) => {
    const currentDate = new Date().toISOString();
    let sortKey = currentDate;
    if (imageMetadata?.DateTimeOriginal) {
        sortKey = imageMetadata.DateTimeOriginal;
    } else if (imageMetadata?.CreateDate) {
        sortKey = imageMetadata.CreateDate;
    } else if (imageMetadata?.ModifyDate) {
        sortKey = imageMetadata.ModifyDate;
    }

    const item = {
        PK: userId,
        SK: sortKey,
        fileName: fileName,
        fileSize: size,
        imageMetadata: imageMetadata,
        createdAt: currentDate,
        updatedAt: currentDate,
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
        return { sortKey, createdAt: currentDate, success: true as const };
    } catch (error) {
        console.error('Error inserting data into DynamoDB:', error);
        return { sortKey, createdAt: currentDate, success: false as const };
    }
};

const resolveGpsCoords = (imageMetadata: any): { lat: number; lng: number } | null => {
    if (!imageMetadata || typeof imageMetadata !== 'object') return null;

    const candidates: Array<{ lat: unknown; lng: unknown }> = [
        { lat: imageMetadata.latitude, lng: imageMetadata.longitude },
        { lat: imageMetadata.gpsCoordinates?.latitude, lng: imageMetadata.gpsCoordinates?.longitude },
    ];

    for (const { lat, lng } of candidates) {
        if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng };
        }
    }
    return null;
};

const saveGeoRowIfApplicable = async (
    userId: string,
    originalSK: string,
    fileName: string,
    createdAt: string,
    imageMetadata?: any,
) => {
    const coords = resolveGpsCoords(imageMetadata);
    if (!coords) return;

    const geoItem = {
        PK: userId,
        SK: `GEO#${originalSK}`,
        lat: coords.lat,
        lng: coords.lng,
        fileName,
        originalSK,
        createdAt,
    };

    try {
        await dynamoDbClient.send(
            new PutItemCommand({
                TableName: DYNAMODB_TABLE,
                Item: marshall(geoItem),
            }),
        );
        console.log('GEO inverse row written:', { userId, originalSK });
    } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        console.error('Failed to write GEO inverse row; main upload row is unaffected', {
            userId,
            originalSK,
            errorName,
        });
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
    const { uploadId, fileName, fileSize, parts, imageMetadata } = JSON.parse(event.body || '{}');

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
        const writeResult = await saveDataToDynamoDb(cognitoUserId, fileName, fileSize, imageMetadata);
        if (writeResult.success) {
            await saveGeoRowIfApplicable(
                cognitoUserId,
                writeResult.sortKey,
                fileName,
                writeResult.createdAt,
                imageMetadata,
            );
        }
        return respond(data);
    } catch (error) {
        return internalServerErrorResponse(error);
    }
};
