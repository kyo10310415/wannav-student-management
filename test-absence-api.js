// Test script to check absence requests API
const axios = require('axios');

async function testAPI() {
  try {
    const response = await axios.get('http://localhost:3000/api/schedules/absence-requests?year=2026&month=3');
    console.log('API Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.success) {
      const requests = response.data.data.requests;
      console.log('\nEvent IDs with absence requests:');
      Object.keys(requests).forEach(eventId => {
        console.log(`Event ID: ${eventId}`);
        requests[eventId].forEach(req => {
          console.log(`  - ${req.tutor_name} (${req.absence_type})`);
        });
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testAPI();
