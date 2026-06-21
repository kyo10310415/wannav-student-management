import { Hono } from 'hono';
import { fetchSuspensionData } from '../services/sheetsService.js';

const app = new Hono();

/**
 * GET /api/suspensions
 * Get all suspension records from Google Sheets
 */
app.get('/', async (c) => {
  try {
    console.log('📋 Fetching suspension data...');
    
    let suspensions = [];
    try {
      suspensions = await fetchSuspensionData();
      console.log(`✅ fetchSuspensionData succeeded: ${suspensions.length} records`);
    } catch (error) {
      console.error('⚠️ fetchSuspensionData failed:', error.message);
      console.error('  Error code:', error.code);
      console.error('  Error status:', error.status);
      return c.json({
        success: true,
        data: [],
        count: 0,
        cache_error: true,
        cache_error_message: error.message
      });
    }
    
    return c.json({
      success: true,
      data: suspensions,
      count: suspensions.length
    });
  } catch (error) {
    console.error('Error fetching suspension data:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;
