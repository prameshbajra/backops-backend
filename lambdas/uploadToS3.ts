import { CreateMultipartUploadCommand, S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APIGatewayProxyHandler } from 'aws-lambda';

const client = new S3Client({ region: process.env.AWS_REGION, useAccelerateEndpoint: true });
const BUCKET_NAME = process.env.BUCKET_NAME as string;
const EXPIRATION_TIME = process.env.EXPIRATION_TIME as string;
const PART_SIZE = 1 * 1024 * 1024; // 1 MB

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const body = JSON.parse(event.body || '{}');
    const { fileName, fileSize } = body;
    const key = fileName;
    const numberOfParts = Math.ceil(fileSize / PART_SIZE);
    console.log(
        'File name: ',
        fileName,
        'Number of parts: ',
        numberOfParts,
        'Part size: ',
        PART_SIZE,
        'File size: ',
        fileSize,
        'BUCKET_NAME: ',
        BUCKET_NAME,
        'EXPIRATION_TIME: ',
        EXPIRATION_TIME,
    );
    try {
        // Step 1: Start multipart upload
        const createMultipartUploadCommand = new CreateMultipartUploadCommand({ Bucket: BUCKET_NAME, Key: key });
        const { UploadId } = await client.send(createMultipartUploadCommand);

        // Step 2: Generate presigned URLs
        const presignedUrls: string[] = [];
        for (let i = 0; i < numberOfParts; i++) {
            const uploadPartCommand = new UploadPartCommand({
                Bucket: BUCKET_NAME,
                Key: key,
                UploadId,
                PartNumber: i + 1,
            });
            const presignedUrl = await getSignedUrl(client, uploadPartCommand, { expiresIn: 3600 });
            presignedUrls.push(presignedUrl);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ uploadId: UploadId, presignedUrls }),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error }),
        };
    }
};
