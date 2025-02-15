import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Context, DynamoDBStreamEvent } from 'aws-lambda';
import fs from 'fs';
import path from 'path';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';

const UPLOAD_BUCKET_NAME = process.env.UPLOAD_BUCKET_NAME as string;
const TMP_FOLDER = '/tmp';

const s3Client = new S3Client({ region: process.env.AWS_REGION, useAccelerateEndpoint: true });
const pipelineAsync = promisify(pipeline);

interface DynamoDBRecord {
    fileName: string;
    fileSize: number;
    PK: string;
    SK: string;
    details: unknown;
}

const downloadFileFromS3 = async (key: string, fileName: string): Promise<string> => {
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

export const lambdaHandler = async (event: DynamoDBStreamEvent, _context: Context): Promise<void> => {
    try {
        for (const record of event.Records) {
            if (record.dynamodb?.NewImage) {
                const newImage = record.dynamodb.NewImage as {
                    [key: string]: AttributeValue;
                };
                const data = unmarshall(newImage) as DynamoDBRecord;
                const { PK, fileName } = data;
                await downloadFileFromS3(`${PK}/${fileName}`, fileName);
            }
        }
    } catch (error) {
        console.error('Error processing DynamoDB stream:', error);
    }
};
