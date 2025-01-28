import {
    RekognitionClient,
    ListCollectionsCommand,
    CreateCollectionCommand,
    DescribeCollectionCommand,
    SearchFacesByImageCommand,
    IndexFacesCommand,
    Attribute,
} from '@aws-sdk/client-rekognition';
import fs from 'fs/promises';

const client = new RekognitionClient({});

const COLLECTION_ID = 'face-rekog';
const BUCKET_NAME = 'backop-upload-bucket';

async function createCollection() {
    try {
        const listCollectionsCommand = new ListCollectionsCommand({});
        const listCollectionsResponse = await client.send(listCollectionsCommand);
        const collectionExists = listCollectionsResponse.CollectionIds.includes(COLLECTION_ID);

        if (collectionExists) {
            console.log(`Collection '${COLLECTION_ID}' already exists.`);
        } else {
            console.log(`Collection '${COLLECTION_ID}' does not exist. Creating it now...`);
            const createCollectionCommand = new CreateCollectionCommand({
                CollectionId: COLLECTION_ID,
            });
            const createCollectionResponse = await client.send(createCollectionCommand);
            console.log('Collection created: ', createCollectionResponse);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function indexFaces() {
    const indexFacesCommand = new IndexFacesCommand({
        CollectionId: COLLECTION_ID,
        Image: {
            S3Object: {
                Bucket: BUCKET_NAME,
                Name: '01b37d5a-3061-70c5-909f-a302900e9e89/andy-hu-B85A8-GHjoI-unsplash.jpg',
            },
        },
        DetectionAttributes: [Attribute.DEFAULT],
        MaxFaces: 10,
    });
    const indexFacesResponse = await client.send(indexFacesCommand);
    console.log('Index Faces Response: ', indexFacesResponse);

    const filePath = './lambdas/tests/indexFacesResponse.json';
    await fs.writeFile(filePath, JSON.stringify(indexFacesResponse, null, 2), 'utf-8');
    console.log(`Response has been written to ${filePath}`);
}

async function describeCollection() {
    const describeCollectionCommand = new DescribeCollectionCommand({
        CollectionId: COLLECTION_ID,
    });
    const describeCollectionResponse = await client.send(describeCollectionCommand);
    console.log('Describe Collection Response: ', describeCollectionResponse);
}

async function searchFacesByImage() {
    const searchFacesByImageCommand = new SearchFacesByImageCommand({
        CollectionId: COLLECTION_ID,
        Image: {
            S3Object: {
                Bucket: BUCKET_NAME,
                Name: '01b37d5a-3061-70c5-909f-a302900e9e89/IMG_9655.jpeg',
            },
        },
        MaxFaces: 5,
    });
    const searchFacesByImageResponse = await client.send(searchFacesByImageCommand);
    console.log('Search Faces By Image Response: ', searchFacesByImageResponse);
    const filePath = './lambdas/tests/searchFacesByImage.json';
    await fs.writeFile(filePath, JSON.stringify(searchFacesByImageResponse, null, 2), 'utf-8');
    console.log(`Response has been written to ${filePath}`);
}

indexFaces();
// describeCollection();
// searchFacesByImage();
