import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Context, EventBridgeEvent, EventBridgeHandler } from 'aws-lambda';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';

const UPLOAD_BUCKET_NAME = process.env.UPLOAD_BUCKET_NAME as string;
const THUMBNAIL_BUCKET_NAME = process.env.THUMBNAIL_BUCKET_NAME as string;
const THUMBNAIL_WIDTH = 200;
const TMP_FOLDER = '/tmp';

const s3Client = new S3Client({ region: process.env.AWS_REGION, useAccelerateEndpoint: true });
const pipelineAsync = promisify(pipeline);
const execPromise = promisify(exec);

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.dng'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv'];

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

const downloadFileFromS3 = async (key: string, fileName: string): Promise<string> => {
    const s3Client = new S3Client({});
    const s3ObjectParams = {
        Bucket: UPLOAD_BUCKET_NAME,
        Key: key,
    };

    console.log('Getting object from S3: ', s3ObjectParams);
    const inputFilePath = path.join(TMP_FOLDER, fileName);
    const s3Object = await s3Client.send(new GetObjectCommand(s3ObjectParams));
    const inputStream = s3Object.Body as Readable;

    await pipelineAsync(inputStream, fs.createWriteStream(inputFilePath));
    console.log(`File downloaded to ${inputFilePath}`);
    return inputFilePath;
};

const generateThumbnail = async (userId: string, fileName: string, inputFilePath: string): Promise<void> => {
    const isImage = IMAGE_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));
    const isVideo = VIDEO_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));

    if (isImage) {
        console.log('Thumbnail generated for image');
        const fileNameWithoutExtension = fileName.split('.').slice(0, -1).join('.');
        const thumbnailFileName = `${fileNameWithoutExtension}.jpg`;
        const thumbnailBuffer = await sharp(inputFilePath).resize(THUMBNAIL_WIDTH).toBuffer();
        await uploadThumbnail(userId, thumbnailFileName, thumbnailBuffer);
        console.log('Thumbnail uploaded to S3:', thumbnailFileName);
    } else if (isVideo) {
        const fileNameWithoutExtension = fileName.split('.').slice(0, -1).join('.');
        const thumbnailFileName = `${fileNameWithoutExtension}.jpg`;
        const thumbnailFilePath = path.join(TMP_FOLDER, thumbnailFileName);
        await generateThumbnailForVideo(inputFilePath, thumbnailFilePath);

        const thumbnailBuffer = fs.readFileSync(thumbnailFilePath);
        await uploadThumbnail(userId, thumbnailFileName, thumbnailBuffer);

        fs.unlinkSync(thumbnailFilePath);
    } else {
        console.log('Unsupported file format for thumbnail generation: ', fileName);
    }
};

const generateThumbnailForVideo = async (inputFilePath: string, thumbnailFilePath: string): Promise<void> => {
    console.log('Generating video thumbnail using ffmpeg...');
    const command = `ffmpeg -i ${inputFilePath} -ss 00:00:01 -frames:v 1 -vf scale=${THUMBNAIL_WIDTH}:-1 ${thumbnailFilePath}`;
    console.log(`Executing command: ${command}`);
    await execPromise(command);
    console.log(`Video thumbnail generated at ${thumbnailFilePath}`);
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
        const inputFilePath = await downloadFileFromS3(key, fileName);
        await generateThumbnail(userId, fileName, inputFilePath);
    } catch (error) {
        console.error('Error generating or saving thumbnail:', error);
    }
};
