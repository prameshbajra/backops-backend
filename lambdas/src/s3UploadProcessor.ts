import { S3Client } from '@aws-sdk/client-s3';
import { Callback, Context, EventBridgeEvent, EventBridgeHandler, Handler, S3Event, S3Handler } from 'aws-lambda';

const s3Client = new S3Client({ region: process.env.AWS_REGION, useAccelerateEndpoint: true });
const BUCKET_NAME = process.env.BUCKET_NAME as string;
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;

export const lambdaHandler: Handler = async (event: Event, _context: Context) => {
    console.log('Records: ', event);
    console.log('Context: ', _context);
    console.log('BUCKET_NAME and TABLE_NAME', BUCKET_NAME, DYNAMODB_TABLE);
};
