import { ScanCommand, ScanCommandInput, WriteRequest } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { buildClient, flushBatch, logResumeKey, parseArgs, resolveCommonOptions } from './lib/common';

interface ImageMeta {
    userId: string;
    originalSK: string;
    fileName: string;
}

const SCAN_LIMIT = 100;
const FACE_PREFIX = 'FACE#';
const IMAGE_PREFIX = 'IMAGE#';
const UNNAMED = '__UNNAMED__';

const run = async (): Promise<void> => {
    const args = parseArgs(process.argv.slice(2));
    const opts = resolveCommonOptions(args);

    const client = buildClient(opts.region);

    const counters = {
        indexedImages: 0,
        faceRowsScanned: 0,
        orphans: 0,
        written: 0,
        skipped: 0,
        errors: 0,
    };

    const imageIndex = new Map<string, ImageMeta>();

    console.log('phase 1: building imageId index from user-keyed rows...');

    let indexStartKey: Record<string, unknown> | undefined = undefined;
    let indexPage = 0;

    do {
        const params: ScanCommandInput = {
            TableName: opts.table,
            ProjectionExpression: 'PK, SK, imageId, fileName',
            FilterExpression:
                'attribute_exists(imageId) AND NOT begins_with(PK, :imagePrefix) AND NOT begins_with(SK, :geoPrefix) AND NOT begins_with(SK, :albumPrefix) AND NOT begins_with(SK, :personPrefix)',
            ExpressionAttributeValues: {
                ':imagePrefix': { S: IMAGE_PREFIX },
                ':geoPrefix': { S: 'GEO#' },
                ':albumPrefix': { S: 'ALBUM#' },
                ':personPrefix': { S: 'PERSON#' },
            },
            Limit: SCAN_LIMIT,
            ExclusiveStartKey: indexStartKey as ScanCommandInput['ExclusiveStartKey'],
        };

        const response = await client.send(new ScanCommand(params));
        const items = response.Items ?? [];

        for (const raw of items) {
            const item = unmarshall(raw);
            const imageId = typeof item.imageId === 'string' ? item.imageId : '';
            const userId = typeof item.PK === 'string' ? item.PK : '';
            const sk = typeof item.SK === 'string' ? item.SK : '';
            const fileName = typeof item.fileName === 'string' ? item.fileName : '';
            if (!imageId || !userId || !sk || !fileName) continue;
            imageIndex.set(imageId, { userId, originalSK: sk, fileName });
        }

        indexStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
        indexPage += 1;
        console.log(`index page=${indexPage} entries=${imageIndex.size}`);
    } while (indexStartKey);

    counters.indexedImages = imageIndex.size;
    console.log(`phase 1 complete: indexed ${counters.indexedImages} images`);

    console.log('phase 2: scanning FACE rows and writing PERSON inverse rows...');

    const buffer: WriteRequest[] = [];

    const flush = async (): Promise<void> => {
        if (buffer.length === 0) return;
        if (opts.dryRun) {
            counters.written += buffer.length;
            buffer.length = 0;
            return;
        }
        const result = await flushBatch(client, opts.table, buffer.splice(0, buffer.length));
        counters.written += result.written;
        if (result.fatal) {
            counters.errors += result.fatal.batch.length;
            console.error('Fatal batch failure:', result.fatal.reason);
            console.error('Batch contents:', JSON.stringify(result.fatal.batch));
            process.exit(1);
        }
    };

    let exclusiveStartKey: Record<string, unknown> | undefined = opts.startKey;
    let batchIndex = 0;

    do {
        const params: ScanCommandInput = {
            TableName: opts.table,
            ProjectionExpression: 'PK, SK, faceName, boundingBox, confidence',
            FilterExpression: 'begins_with(PK, :imagePrefix) AND begins_with(SK, :facePrefix)',
            ExpressionAttributeValues: {
                ':imagePrefix': { S: IMAGE_PREFIX },
                ':facePrefix': { S: FACE_PREFIX },
            },
            Limit: SCAN_LIMIT,
            ExclusiveStartKey: exclusiveStartKey as ScanCommandInput['ExclusiveStartKey'],
        };

        const response = await client.send(new ScanCommand(params));
        const items = response.Items ?? [];
        counters.faceRowsScanned += items.length;

        for (const raw of items) {
            const item = unmarshall(raw);
            const pk = typeof item.PK === 'string' ? item.PK : '';
            const sk = typeof item.SK === 'string' ? item.SK : '';
            if (!pk.startsWith(IMAGE_PREFIX) || !sk.startsWith(FACE_PREFIX)) {
                counters.skipped += 1;
                continue;
            }

            const imageId = pk.slice(IMAGE_PREFIX.length);
            const faceId = sk.slice(FACE_PREFIX.length);
            if (!imageId || !faceId) {
                counters.skipped += 1;
                continue;
            }

            const meta = imageIndex.get(imageId);
            if (!meta) {
                console.warn(`orphan face row | imageId=${imageId} faceId=${faceId}`);
                counters.orphans += 1;
                continue;
            }

            const faceName = typeof item.faceName === 'string' && item.faceName.length > 0 ? item.faceName : undefined;
            const nameSegment = faceName ?? UNNAMED;

            const boundingBox =
                typeof item.boundingBox === 'object' && item.boundingBox !== null ? item.boundingBox : undefined;
            const confidence = typeof item.confidence === 'number' ? item.confidence : undefined;

            const personItem: Record<string, unknown> = {
                PK: meta.userId,
                SK: `PERSON#${nameSegment}#${faceId}`,
                faceId,
                imageId,
                originalSK: meta.originalSK,
                fileName: meta.fileName,
                boundingBox,
                confidence,
                updatedAt: new Date().toISOString(),
            };
            if (faceName) personItem.faceName = faceName;

            if (opts.dryRun) {
                console.log(
                    `[DRY] PUT PERSON#${nameSegment}#${faceId} | userId=${meta.userId} | fileName=${meta.fileName}`,
                );
                counters.written += 1;
                continue;
            }

            buffer.push({
                PutRequest: {
                    Item: marshall(personItem, { removeUndefinedValues: true }),
                },
            });

            if (buffer.length >= opts.batchSize) {
                await flush();
            }
        }

        exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
        batchIndex += 1;
        console.log(
            `progress | batch=${batchIndex} faceRowsScanned=${counters.faceRowsScanned} written=${counters.written} orphans=${counters.orphans} skipped=${counters.skipped}`,
        );
        logResumeKey(exclusiveStartKey);
    } while (exclusiveStartKey);

    await flush();

    console.log('summary:', JSON.stringify(counters));
};

run().catch((error) => {
    console.error('backfill-people failed:', error);
    process.exit(1);
});
