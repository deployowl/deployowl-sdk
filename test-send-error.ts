import { init, captureError, close } from './src/index';

const API_KEY = 'test_key_123';
const ENDPOINT = 'https://api.deployowl.com';

async function testSDK() {
    console.log('--- Initializing SDK ---');
    init({
        apiKey: API_KEY,
        endpoint: ENDPOINT,
        environment: 'local-test',
    });

    console.log('--- Capturing Error ---');
    try {
        throw new Error('Test Error from local script: ' + new Date().toISOString());
    } catch (error) {
        captureError(error as Error, {
            user: 'test-user',
            tags: ['test', 'local'],
        });
    }

    console.log('--- Closing SDK (flushing) ---');
    await close();
    console.log('--- Test Complete ---');
}

testSDK().catch(console.error);
