import { DynamoDBClient, QueryCommand, QueryCommandInput } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyHandler } from 'aws-lambda';
import {
    customErrorResponse,
    getUserInfo,
    internalServerErrorResponse,
    respond,
    unauthorizedResponse,
    validateAccessToken,
} from '../utility';

const dynamoDbClient = new DynamoDBClient({});
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE as string;
const PERSON_PREFIX = 'PERSON#';
const PAGE_SIZE = 100;
const PROJECTION = 'SK, faceId, imageId, originalSK, fileName, boundingBox, confidence';

interface FaceRef {
    faceId: string;
    imageId: string;
    originalSK: string;
    fileName: string;
    boundingBox: Record<string, unknown>;
    confidence: number;
}

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

const decodeNextToken = (token: string): Record<string, unknown> | null => {
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === 'object') {
            return parsed as Record<string, unknown>;
        }
        return null;
    } catch (error) {
        console.warn('Failed to decode nextToken:', error);
        return null;
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

    let body: { name?: unknown; nextToken?: unknown };
    try {
        body = JSON.parse(event.body || '{}');
    } catch (error) {
        console.warn('Invalid JSON body:', error);
        return customErrorResponse(400, 'Invalid JSON body');
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
        return customErrorResponse(400, 'name is required');
    }

    let exclusiveStartKey: Record<string, unknown> | undefined = undefined;
    if (typeof body.nextToken === 'string' && body.nextToken.length > 0) {
        const decoded = decodeNextToken(body.nextToken);
        if (!decoded) {
            return customErrorResponse(400, 'Invalid nextToken');
        }
        exclusiveStartKey = decoded;
    }

    try {
        const prefix = `${PERSON_PREFIX}${name}#`;
        const params: QueryCommandInput = {
            TableName: DYNAMODB_TABLE,
            KeyConditionExpression: 'PK = :userId AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: {
                ':userId': { S: cognitoUserId },
                ':prefix': { S: prefix },
            },
            ProjectionExpression: PROJECTION,
            Limit: PAGE_SIZE,
        };
        if (exclusiveStartKey) {
            params.ExclusiveStartKey = exclusiveStartKey as QueryCommandInput['ExclusiveStartKey'];
        }

        const data = await dynamoDbClient.send(new QueryCommand(params));
        const items: FaceRef[] = [];
        if (data.Items) {
            for (const raw of data.Items) {
                const ref = toFaceRef(unmarshall(raw));
                if (ref) items.push(ref);
            }
        }

        const nextToken = data.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64')
            : null;

        return respond({ items, nextToken });
    } catch (error) {
        console.error('Error querying person photos from DynamoDB:', error);
        return internalServerErrorResponse('Failed to query person photos from DynamoDB');
    }
};
