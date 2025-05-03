import {
    RekognitionClient,
    ListCollectionsCommand,
    CreateCollectionCommand,
    DescribeCollectionCommand,
    SearchFacesCommand,
    SearchFacesByImageCommand,
    DeleteCollectionCommand,
    IndexFacesCommand,
    Attribute,
} from '@aws-sdk/client-rekognition';
import fs from 'fs/promises';

const client = new RekognitionClient({});

const COLLECTION_ID = '01b37d5a-3061-70c5-909f-a302900e9e89';
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
                Name: '01b37d5a-3061-70c5-909f-a302900e9e89/IMG_1879.JPG',
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
                Name: 'Xnip2025-05-03_21-19-44.png',
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

async function searchFacesByFaceId(faceId) {
    const searchFacesCommand = new SearchFacesCommand({
        CollectionId: COLLECTION_ID,
        FaceId: faceId,
        MaxFaces: 5,
    });

    const searchFacesResponse = await client.send(searchFacesCommand);
    console.log('Search Faces Response: ', searchFacesResponse);

    const filePath = './lambdas/tests/searchFacesByFaceId.json';
    await fs.writeFile(filePath, JSON.stringify(searchFacesResponse, null, 2), 'utf-8');
    console.log(`Response has been written to ${filePath}`);
}

async function deleteCollection(collectionId) {
    try {
        const deleteCollectionCommand = new DeleteCollectionCommand({
            CollectionId: collectionId ?? COLLECTION_ID,
        });
        const deleteCollectionResponse = await client.send(deleteCollectionCommand);
        console.log('Delete Collection Response: ', deleteCollectionResponse);
    } catch (error) {
        console.error('Error deleting collection:', error);
    }
}

async function listAllCollections() {
    try {
        const listCollectionsCommand = new ListCollectionsCommand({});
        const listCollectionsResponse = await client.send(listCollectionsCommand);
        console.log('List of Collections:', listCollectionsResponse.CollectionIds);
    } catch (error) {
        console.error('Error listing collections:', error);
    }
}

// indexFaces();
// describeCollection();
// searchFacesByImage();
searchFacesByFaceId('f67d73fe-427c-40b2-9a3c-adceb37d4d36');
// createCollection();
// deleteCollection('01b37d5a-3061-70c5-909f-a302900e9e89');
// deleteCollection('6ed44618-f837-341a-9e2e-2c97b923c0c0');
// listAllCollections();
