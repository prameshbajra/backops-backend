import {
    RekognitionClient,
    ListCollectionsCommand,
    CreateCollectionCommand,
    IndexFacesCommand,
    Attribute,
} from '@aws-sdk/client-rekognition';
import fs from 'fs/promises';

const client = new RekognitionClient({});

const COLLECTION_ID = 'face-rekog';
const BUCKET_NAME = 'backop-upload-bucket';

async function main() {
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

        const indexFacesCommand = new IndexFacesCommand({
            CollectionId: COLLECTION_ID,
            Image: {
                S3Object: {
                    Bucket: BUCKET_NAME,
                    Name: '01b37d5a-3061-70c5-909f-a302900e9e89/IMG-e2bc6a0a71f32d99d6f8e7a26e09b3ae-V_2.jpg',
                },
            },
            DetectionAttributes: [Attribute.ALL],
            MaxFaces: 5,
        });
        const indexFacesResponse = await client.send(indexFacesCommand);
        console.log('Index Faces Response: ', indexFacesResponse);

        const filePath = './indexFacesResponse.json';
        await fs.writeFile(filePath, JSON.stringify(indexFacesResponse, null, 2), 'utf-8');
        console.log(`Response has been written to ${filePath}`);
    } catch (error) {
        console.error('Error:', error);
    }
}

main();
