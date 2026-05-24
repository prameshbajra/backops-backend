import { DynamoDBClient, QueryCommand, QueryCommandInput } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from '../utility';

const dynamoDbClient = new DynamoDBClient({});
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;
const PERSON_PREFIX = 'PERSON#';
const UNNAMED = '__UNNAMED__';
const PAGE_SIZE = 500;
const PROJECTION = 'SK, faceName, faceId, imageId, originalSK, fileName, boundingBox, confidence';

interface FaceRef {
    faceId: string;
    imageId: string;
    originalSK: string;
    fileName: string;
    boundingBox: Record<string, unknown>;
    confidence: number;
}

interface NamedPerson {
    name: string;
    count: number;
    sample: FaceRef;
}

const parseNameFromSK = (sk: string): string | null => {
    if (!sk.startsWith(PERSON_PREFIX)) return null;
    const tail = sk.slice(PERSON_PREFIX.length);
    const lastHash = tail.lastIndexOf('#');
    if (lastHash < 0) return null;
    const name = tail.slice(0, lastHash);
    if (name.length === 0) return null;
    return name;
};

const toFaceRef = (item: Record<string, unknown>): FaceRef | null => {
    const faceId = typeof item.faceId === 'string' ? item.faceId : '';
    const imageId = typeof item.imageId === 'string' ? item.imageId : '';
    const originalSK = typeof item.originalSK === 'string' ? item.originalSK : '';
    const fileName = typeof item.fileName === 'string' ? item.fileName : '';
    const boundingBox =
        typeof item.boundingBox === 'object' && item.boundingBox !== null
            ? (item.boundingBox as Record<string, unknown>)
            : {};
    const confidence = typeof item.confidence === 'number' ? item.confidence : 0;

    if (!faceId || !imageId) return null;
    return { faceId, imageId, originalSK, fileName, boundingBox, confidence };
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

    try {
        const namedBuckets = new Map<string, { count: number; sample: FaceRef }>();
        const unnamed: FaceRef[] = [];

        let exclusiveStartKey: Record<string, unknown> | undefined = undefined;
        let pageCount = 0;
        do {
            const params: QueryCommandInput = {
                TableName: DYNAMODB_TABLE,
                KeyConditionExpression: 'PK = :userId AND begins_with(SK, :personPrefix)',
                ExpressionAttributeValues: {
                    ':userId': { S: cognitoUserId },
                    ':personPrefix': { S: PERSON_PREFIX },
                },
                ProjectionExpression: PROJECTION,
                Limit: PAGE_SIZE,
            };
            if (exclusiveStartKey) {
                params.ExclusiveStartKey = exclusiveStartKey as QueryCommandInput['ExclusiveStartKey'];
            }

            const data = await dynamoDbClient.send(new QueryCommand(params));
            const items = data.Items ? data.Items.map((item) => unmarshall(item)) : [];

            for (const item of items) {
                const sk = typeof item.SK === 'string' ? item.SK : '';
                const name = parseNameFromSK(sk);
                if (!name) continue;

                const ref = toFaceRef(item);
                if (!ref) continue;

                if (name === UNNAMED) {
                    unnamed.push(ref);
                } else {
                    const existing = namedBuckets.get(name);
                    if (existing) {
                        existing.count += 1;
                    } else {
                        namedBuckets.set(name, { count: 1, sample: ref });
                    }
                }
            }

            exclusiveStartKey = data.LastEvaluatedKey as Record<string, unknown> | undefined;
            pageCount += 1;
        } while (exclusiveStartKey);

        if (pageCount > 10) {
            console.warn(
                `getPeople aggregated across ${pageCount} pages for user ${cognitoUserId}; consider revisiting server-side aggregation.`,
            );
        }

        const named: NamedPerson[] = Array.from(namedBuckets.entries())
            .map(([name, bucket]) => ({ name, count: bucket.count, sample: bucket.sample }))
            .sort((a, b) => b.count - a.count);

        return respond({ named, unnamed });
    } catch (error) {
        console.error('Error querying people from DynamoDB:', error);
        return internalServerErrorResponse('Failed to query people from DynamoDB');
    }
};
