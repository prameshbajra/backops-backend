# Backfill scripts

One-off local scripts that populate inverse rows for data uploaded before the
inverse-write code went live.

## `backfill-geo.ts`

Walks every user-keyed photo row, and when `imageMetadata.latitude`/`longitude`
(or `imageMetadata.gpsCoordinates.latitude`/`longitude`) is a finite, non-zero
number, writes the matching `GEO#<originalSK>` inverse row. Run **once per
environment after PR D-1 ships**.

## `backfill-people.ts`

Scans `IMAGE#…/FACE#…` face rows and writes the matching
`PERSON#<name|__UNNAMED__>#<faceId>` inverse rows under the owning user's
partition. Needs to walk the user-keyed image rows first to build an
`imageId → {userId, originalSK, fileName}` lookup. Run **once per environment
after PR E-1 ships**.

## Invocation

Run from `backops-backend/lambdas/` (the scripts share that package's
`node_modules`).

```bash
cd backops-backend/lambdas

# dry-run first — logs every Put without writing
AWS_PROFILE=<profile> AWS_REGION=ap-south-1 \
  npm run backfill:geo -- --dry-run

# then commit
AWS_PROFILE=<profile> AWS_REGION=ap-south-1 \
  npm run backfill:geo

# same for people
AWS_PROFILE=<profile> AWS_REGION=ap-south-1 \
  npm run backfill:people -- --dry-run

AWS_PROFILE=<profile> AWS_REGION=ap-south-1 \
  npm run backfill:people
```

### Flags

- `--dry-run` — log Puts that *would* happen; no writes.
- `--batch-size N` — chunk size for `BatchWriteItem`. Default 25, clamped to 25.
- `--start-key '<json>'` — resume from a previous run's `RESUME_KEY=...` log.
- `--region <region>` — override `AWS_REGION`.
- `--table <name>` — override `DYNAMODB_TABLE` (default `BackOpsTable`).

## Pre-flight checklist

1. `AWS_PROFILE` exported (the script uses the default credential chain).
2. `AWS_REGION` exported, or pass `--region`. No default — fails loudly.
3. Confirm the right account/table: `aws sts get-caller-identity` and double-check
   the table name. The DDB writes are best-effort idempotent (last write wins),
   but writing to the wrong account is still painful.
4. Always run with `--dry-run` first and skim the output.
5. Each progress checkpoint logs `RESUME_KEY={json}`. Save the last one in case
   the run is interrupted — pass it back via `--start-key '...'`.

## Type-check

```bash
cd backops-backend/lambdas
npm run compile:scripts
```
