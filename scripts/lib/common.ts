import {
    BatchWriteItemCommand,
    BatchWriteItemCommandOutput,
    DynamoDBClient,
    WriteRequest,
} from '@aws-sdk/client-dynamodb';

export interface CommonOptions {
    dryRun: boolean;
    batchSize: number;
    startKey?: Record<string, unknown>;
    table: string;
    region: string;
}

export interface ParsedArgs {
    [key: string]: string | boolean;
}

const DEFAULT_TABLE = 'BackOpsTable';
const DEFAULT_BATCH = 25;
const MAX_BATCH = 25;

export const parseArgs = (argv: string[]): ParsedArgs => {
    const out: ParsedArgs = {};
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (!tok.startsWith('--')) continue;
        const key = tok.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            out[key] = true;
        } else {
            out[key] = next;
            i += 1;
        }
    }
    return out;
};

export const resolveCommonOptions = (args: ParsedArgs): CommonOptions => {
    const region = (typeof args.region === 'string' && args.region) || process.env.AWS_REGION || '';
    if (!region) {
        console.error('AWS_REGION not set. Pass --region <region> or export AWS_REGION.');
        process.exit(1);
    }

    const table = (typeof args.table === 'string' && args.table) || process.env.DYNAMODB_TABLE || DEFAULT_TABLE;

    let batchSize = DEFAULT_BATCH;
    if (typeof args['batch-size'] === 'string') {
        const parsed = Number(args['batch-size']);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            console.error(`Invalid --batch-size value: ${args['batch-size']}`);
            process.exit(1);
        }
        batchSize = Math.min(Math.floor(parsed), MAX_BATCH);
    }

    let startKey: Record<string, unknown> | undefined;
    if (typeof args['start-key'] === 'string') {
        try {
            startKey = JSON.parse(args['start-key']);
        } catch (error) {
            console.error('Failed to parse --start-key JSON:', (error as Error).message);
            process.exit(1);
        }
    }

    return {
        dryRun: args['dry-run'] === true,
        batchSize,
        startKey,
        table,
        region,
    };
};

export const buildClient = (region: string): DynamoDBClient => new DynamoDBClient({ region });

const isThrottle = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const name = (error as { name?: string }).name || '';
    return (
        name === 'ProvisionedThroughputExceededException' ||
        name === 'ThrottlingException' ||
        name === 'RequestLimitExceeded'
    );
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const jitteredBackoff = (attempt: number): number => {
    const base = 500;
    const cap = 30_000;
    const exp = Math.min(cap, base * 2 ** attempt);
    return Math.floor(Math.random() * exp);
};

const MAX_RETRIES = 6;

export interface FlushResult {
    written: number;
    fatal?: { batch: WriteRequest[]; reason: string };
}

export const flushBatch = async (
    client: DynamoDBClient,
    table: string,
    requests: WriteRequest[],
): Promise<FlushResult> => {
    if (requests.length === 0) return { written: 0 };

    let pending: WriteRequest[] = requests;
    let totalWritten = 0;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response: BatchWriteItemCommandOutput = await client.send(
                new BatchWriteItemCommand({
                    RequestItems: { [table]: pending },
                }),
            );
            const unprocessed = response.UnprocessedItems?.[table] ?? [];
            const writtenThisRound = pending.length - unprocessed.length;
            totalWritten += writtenThisRound;

            if (unprocessed.length === 0) {
                return { written: totalWritten };
            }

            if (attempt === MAX_RETRIES) {
                return {
                    written: totalWritten,
                    fatal: { batch: unprocessed, reason: 'UnprocessedItems exceeded retry budget' },
                };
            }

            pending = unprocessed;
            const wait = jitteredBackoff(attempt);
            console.warn(
                `BatchWrite returned ${unprocessed.length} UnprocessedItems; retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`,
            );
            await sleep(wait);
        } catch (error) {
            if (!isThrottle(error) || attempt === MAX_RETRIES) {
                return {
                    written: totalWritten,
                    fatal: { batch: pending, reason: (error as Error).message || 'unknown error' },
                };
            }
            const wait = jitteredBackoff(attempt);
            console.warn(
                `BatchWrite throttled (${(error as Error).name}); retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`,
            );
            await sleep(wait);
        }
    }

    return { written: totalWritten, fatal: { batch: pending, reason: 'retry loop exhausted' } };
};

export const logResumeKey = (lastEvaluatedKey: Record<string, unknown> | undefined): void => {
    if (!lastEvaluatedKey) return;
    console.log(`RESUME_KEY=${JSON.stringify(lastEvaluatedKey)}`);
};
