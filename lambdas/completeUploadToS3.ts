import { S3Client, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { HEADERS } from './headers';

const client = new S3Client({ region: process.env.AWS_REGION });

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const bucketName = process.env.BUCKET_NAME as string;
    const { uploadId, key, parts } = JSON.parse(event.body || '{}');
    console.log('Completing multipart upload in progress: ', { uploadId, key, parts });

    if (!uploadId || !key || !parts) {
        return {
            statusCode: 400,
            headers: HEADERS,
            body: JSON.stringify({ message: 'Missing parameters' }),
        };
    }

    const params = {
        Bucket: bucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
    };

    try {
        const command = new CompleteMultipartUploadCommand(params);
        const data = await client.send(command);
        console.log('Multipart upload completed', data);
        return {
            statusCode: 200,
            headers: HEADERS,
            body: JSON.stringify(data),
        };
    } catch (error) {
        console.error('Error completing multipart upload', error);
        return {
            statusCode: 500,
            headers: HEADERS,
            body: JSON.stringify({ error }),
        };
    }
};
