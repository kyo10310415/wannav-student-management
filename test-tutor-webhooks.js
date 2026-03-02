import { fetchTutorWebhooks } from './src/services/sheetsService.js';

async function test() {
  try {
    console.log('Testing fetchTutorWebhooks...');
    const webhookMap = await fetchTutorWebhooks();
    console.log('Success! Retrieved webhooks:', Object.keys(webhookMap).length);
    console.log('Tutor names:', Object.keys(webhookMap));
    console.log('\nSample data:', Object.entries(webhookMap).slice(0, 3));
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  }
}

test();
