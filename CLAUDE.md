# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BackOps Backend is a serverless photo/video management application built on AWS. The application handles file uploads, thumbnail generation, face recognition, album management, and user authentication through AWS Cognito.

## Architecture

The project uses AWS SAM (Serverless Application Model) with a nested stack architecture:

- **Main Stack** (`template.yaml`): Orchestrates all sub-stacks
- **S3 Stack** (`s3.yml`): Two buckets - `backop-upload-bucket` for originals, `backop-thumbnail-bucket` for thumbnails
- **Cognito Stack** (`cognito.yml`): User authentication with JWT tokens
- **Database Stack** (`database.yml`): Single DynamoDB table `BackOpsTable` with PK/SK composite key pattern
- **API Stack** (`api-lambda.yml`): Lambda functions and API Gateway endpoints

### Key Components

**Lambda Functions:**
- Authentication: `signin.ts`, `signout.ts`, `getLoggedInUser.ts`
- File Operations: `uploadToS3.ts`, `completeUploadToS3.ts`, `downloadFileFromS3.ts`, `deleteObjectsInS3.ts`
- Media Processing: `generateThumbnail.ts` (uses Sharp layer for images, FFmpeg for videos)
- Face Recognition: `indexFaces.ts`, `checkForExistingFaces.ts`, `getFaces.ts`, `updateFaceData.ts`
- Album Management: `createUpdateAlbum.ts`, `getAllAlbumForUser.ts`
- Data Queries: `getObjectList.ts`, `getObject.ts`

**DynamoDB Data Model:**
- Uses single table design with PK (partition key) and SK (sort key)
- Streams enabled for triggering face recognition workflows

## Development Commands

### Root Directory
```bash
# Install dependencies
npm install --include=dev

# Deploy to AWS
sam build && sam deploy
```

### Lambda Directory (`lambdas/`)
```bash
# Install lambda dependencies
cd lambdas && npm install --include=dev

# Run tests
npm test              # Compiles TypeScript and runs Jest
npm run unit         # Run Jest tests only
npm run compile      # TypeScript compilation
npm run lint         # ESLint with auto-fix
```

## Development Workflow

1. **Installation**: Install dependencies both in root and `lambdas/` directories
2. **Development**: Use AWS SAM Accelerate for faster development cycle (see README.md reference)
3. **Testing**: Tests are located in `lambdas/test/` and `lambdas/tests/` directories
4. **Building**: Uses ESBuild for Lambda function compilation
5. **Deployment**: SAM handles all AWS resource provisioning

## Important Constraints

- Upload function has throttling limit of 400 requests
- UI should limit to max 100 files per upload batch
- Complete multipart upload function shares the 400 throttling limit
- Download and delete functions support bulk operations
- Generate thumbnail function is triggered automatically on S3 upload events via EventBridge

## File Structure

```
lambdas/src/
├── album/              # Album management functions
├── rekognition/        # Face recognition functions  
├── *.ts               # Core Lambda functions
├── headers.ts         # Shared HTTP headers
└── utility.ts         # Shared utility functions
```

## AWS Services Integration

- **S3**: File storage with lifecycle policies and EventBridge integration
- **DynamoDB**: Single table with streams for triggering workflows
- **Cognito**: JWT-based authentication
- **Rekognition**: Face detection and recognition
- **API Gateway**: HTTP API with JWT authorizer
- **Lambda**: Serverless compute with multiple runtime versions (Node.js 20.x, 22.x)
- **EventBridge**: S3 event handling for thumbnail generation

## Key Development Notes

- Functions use both CommonJS and ESM formats depending on requirements
- Sharp layer required for image processing (x86_64 architecture)
- FFmpeg layer from AWS Serverless Application Repository for video processing
- DynamoDB streams trigger face recognition workflows
- Architecture diagram available in `BackopsBackendArchi.drawio`