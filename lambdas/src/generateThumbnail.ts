import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { marshall } from '@aws-sdk/util-dynamodb';
import { Context, EventBridgeEvent, EventBridgeHandler } from 'aws-lambda';
import sharp from 'sharp';
import { Readable } from 'stream';
import { streamToBuffer } from './utility';

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;
const UPLOAD_BUCKET_NAME = process.env.UPLOAD_BUCKET_NAME as string;
const THUMBNAIL_BUCKET_NAME = process.env.THUMBNAIL_BUCKET_NAME as string;
const THUMBNAIL_WIDTH = 200;

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const dynamoDbClient = new DynamoDBClient({});

interface S3ObjectDetail {
    key: string;
    size: number;
}

const uploadThumbnail = async (userId: string, fileName: string, thumbnailBuffer: Buffer): Promise<string> => {
    const thumbnailKey = `${userId}/${fileName}`;
    const params = {
        Bucket: THUMBNAIL_BUCKET_NAME,
        Key: thumbnailKey,
        Body: thumbnailBuffer,
    };
    console.log('Uploading thumbnail to S3:', params);
    await s3Client.send(new PutObjectCommand(params));
    console.log('Thumbnail uploaded to S3:', thumbnailKey);
    return thumbnailKey;
};

const generateThumbnail = async (key: string): Promise<Buffer> => {
    const s3ObjectParams = {
        Bucket: UPLOAD_BUCKET_NAME,
        Key: key,
    };
    console.log('Getting object from S3: ', s3ObjectParams);
    const s3Object = await s3Client.send(new GetObjectCommand(s3ObjectParams));
    const imageBuffer = await streamToBuffer(s3Object.Body as Readable);
    const thumbnailBuffer = await sharp(imageBuffer).resize(THUMBNAIL_WIDTH).jpeg().toBuffer();
    return thumbnailBuffer;
};

const saveDataToDynamoDb = async (userId: string, fileName: string, size: number, thumbnailKey: string) => {
    const currentDate = new Date().toISOString();
    const item = {
        userId: userId,
        date: currentDate,
        fileName: fileName,
        fileSize: size,
        thumbnailKey: thumbnailKey,
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

export const lambdaHandler: EventBridgeHandler<'ObjectCreated', { object: S3ObjectDetail }, void> = async (
    event: EventBridgeEvent<'ObjectCreated', { object: S3ObjectDetail }>,
    _context: Context,
) => {
    const fileDetails = event.detail.object;
    const { key, size } = fileDetails;
    const [userId, fileName] = key.split('/');
    console.log('Key: ', key, 'Size: ', size, 'UserId: ', userId, 'FileName: ', fileName);
    try {
        const thumbnailBuffer = await generateThumbnail(key);
        const thumbnailKey = await uploadThumbnail(userId, fileName, thumbnailBuffer);
        console.log('Thumbnail generated and uploaded: ', thumbnailKey);
        await saveDataToDynamoDb(userId, fileName, size, thumbnailKey);
    } catch (error) {
        console.error('Error generating or saving thumbnail:', error);
    }
};
