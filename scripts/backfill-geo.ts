import { ScanCommand, ScanCommandInput, WriteRequest } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { buildClient, flushBatch, logResumeKey, parseArgs, resolveCommonOptions } from './lib/common';

interface Coords {
    lat: number;
    lng: number;
}

const resolveGpsCoords = (imageMetadata: unknown): Coords | null => {
    if (!imageMetadata || typeof imageMetadata !== 'object') return null;
    const md = imageMetadata as Record<string, unknown>;
    const nested = md.gpsCoordinates && typeof md.gpsCoordinates === 'object'
        ? (md.gpsCoordinates as Record<string, unknown>)
        : undefined;

    const candidates: Array<{ lat: unknown; lng: unknown }> = [
        { lat: md.latitude, lng: md.longitude },
        { lat: nested?.latitude, lng: nested?.longitude },
    ];

    for (const { lat, lng } of candidates) {
        if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng };
        }
    }
    return null;
};

const SCAN_LIMIT = 100;

const run = async (): Promise<void> => {
    const args = parseArgs(process.argv.slice(2));
    const opts = resolveCommonOptions(args);

    const client = buildClient(opts.region);

    const counters = {
        scanned: 0,
        candidates: 0,
        written: 0,
        skipped: 0,
        errors: 0,
    };

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
            ProjectionExpression: 'PK, SK, fileName, imageId, imageMetadata, createdAt',
            FilterExpression:
                'NOT begins_with(PK, :imagePrefix) AND NOT begins_with(SK, :geoPrefix) AND NOT begins_with(SK, :albumPrefix) AND NOT begins_with(SK, :personPrefix)',
            ExpressionAttributeValues: {
                ':imagePrefix': { S: 'IMAGE#' },
                ':geoPrefix': { S: 'GEO#' },
                ':albumPrefix': { S: 'ALBUM#' },
                ':personPrefix': { S: 'PERSON#' },
            },
            Limit: SCAN_LIMIT,
            ExclusiveStartKey: exclusiveStartKey as ScanCommandInput['ExclusiveStartKey'],
        };

        const response = await client.send(new ScanCommand(params));
        const items = response.Items ?? [];
        counters.scanned += items.length;

        for (const raw of items) {
            const item = unmarshall(raw);
            const sk = typeof item.SK === 'string' ? item.SK : '';
            if (sk.startsWith('GEO#') || sk.startsWith('ALBUM#') || sk.startsWith('PERSON#')) {
                continue;
            }

            const md = item.imageMetadata;
            if (typeof md === 'string') {
                console.warn(`Skipping row with string imageMetadata: PK=${item.PK} SK=${sk}`);
                counters.skipped += 1;
                continue;
            }
            if (md === undefined || md === null) {
                counters.skipped += 1;
                continue;
            }

            const coords = resolveGpsCoords(md);
            if (!coords) {
                counters.skipped += 1;
                continue;
            }

            if (coords.lat === 0 && coords.lng === 0) {
                console.warn(`Skipping Null Island (0,0) coords: PK=${item.PK} SK=${sk}`);
                counters.skipped += 1;
                continue;
            }

            const fileName = typeof item.fileName === 'string' ? item.fileName : '';
            if (!fileName) {
                console.warn(`Row missing fileName; skipping: PK=${item.PK} SK=${sk}`);
                counters.skipped += 1;
                continue;
            }

            const userId = typeof item.PK === 'string' ? item.PK : '';
            if (!userId) {
                console.warn(`Row missing userId (PK); skipping: SK=${sk}`);
                counters.skipped += 1;
                continue;
            }

            counters.candidates += 1;

            const createdAt = typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString();

            const geoItem: Record<string, unknown> = {
                PK: userId,
                SK: `GEO#${sk}`,
                lat: coords.lat,
                lng: coords.lng,
                fileName,
                originalSK: sk,
                createdAt,
            };
            if (typeof item.imageId === 'string' && item.imageId.length > 0) {
                geoItem.imageId = item.imageId;
            }

            if (opts.dryRun) {
                console.log(
                    `[DRY] PUT GEO#${sk} | userId=${userId} | fileName=${fileName} | lat=${coords.lat} | lng=${coords.lng}`,
                );
                counters.written += 1;
                continue;
            }

            buffer.push({
                PutRequest: {
                    Item: marshall(geoItem, { removeUndefinedValues: true }),
                },
            });

            if (buffer.length >= opts.batchSize) {
                await flush();
            }
        }

        exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
        batchIndex += 1;
        console.log(
            `progress | batch=${batchIndex} scanned=${counters.scanned} candidates=${counters.candidates} written=${counters.written} skipped=${counters.skipped}`,
        );
        logResumeKey(exclusiveStartKey);
    } while (exclusiveStartKey);

    await flush();

    console.log('summary:', JSON.stringify(counters));
};

run().catch((error) => {
    console.error('backfill-geo failed:', error);
    process.exit(1);
});
