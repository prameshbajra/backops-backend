# Repository Guidelines

## Project Structure & Module Organization
- Root: AWS SAM templates (`template.yaml`, `api-lambda.yml`), infra configs (`cognito.yml`, `s3.yml`, `samconfig.toml`).
- `lambdas/`: TypeScript Lambda sources in `src/` (e.g., `src/uploadToS3.ts`, `src/rekognition/...`), shared `layers/`, tests in `tests/unit/`.
- `events/`: Sample/event payloads for local testing.
- Node dependencies: root for shared SDKs; `lambdas/` for function code.

## Build, Test, and Development Commands
- Install deps (root and lambdas): `npm install --include=dev` then `cd lambdas && npm install`.
- Run unit tests (Jest): `cd lambdas && npm test`.
- Lint/format (ESLint + Prettier): `cd lambdas && npm run lint`.
- Compile TypeScript: `cd lambdas && npm run compile`.
- Build & deploy (SAM): `sam build && sam deploy`.

## Coding Style & Naming Conventions
- Language: TypeScript for Lambda code.
- Formatting: Prettier (4 spaces, single quotes, semicolons, trailing commas, width 120).
- Linting: `@typescript-eslint` with recommended rules; fix warnings before commit.
- Naming: camelCase for variables/functions; PascalCase for classes/types; group domain logic under folders (e.g., `src/album/`, `src/rekognition/`).

## Testing Guidelines
- Framework: Jest with `ts-jest`.
- Location & pattern: place tests under `lambdas/tests/unit/` with `*.test.ts` filenames.
- Coverage: Jest collects coverage to `lambdas/coverage/`; add tests with new/changed code.
- Run: `cd lambdas && npm test` (compiles then runs unit tests).

## Commit & Pull Request Guidelines
- Commits: concise, imperative subject lines (e.g., "Implement batch deletion in DynamoDB"). Include scope when helpful.
- PRs: clear description, rationale, and links to issues. Include test results and example requests (e.g., sample event or `curl`) when relevant.

## Security & Configuration Tips
- Do not commit secrets; prefer AWS Profiles and SAM parameters. Configure via `template.yaml` and `samconfig.toml`.
- Validate IAM least privilege for new Lambdas and resources.
- Large operations (upload/delete) are throttled; keep batch sizes in mind when changing related code paths.

