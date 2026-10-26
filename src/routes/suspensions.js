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
      console.log('✅ Suspension data loaded', { count: Number.isSafeInteger(suspensions.length) ? suspensions.length : 0 });
    } catch (error) {
      console.error('⚠️ fetchSuspensionData failed');
      console.error('Suspension source error');
      console.error('Suspension source unavailable');
      return c.json({
        success: true,
        data: [],
        count: 0,
        cache_error: true,
        cache_error_message: 'Suspension data could not be loaded'
      });
    }
    
    return c.json({
      success: true,
      data: suspensions,
      count: suspensions.length
    });
  } catch (error) {
    console.error('Error fetching suspension data');
    return c.json({
      success: false,
      error: 'Suspension data could not be loaded'
    }, 500);
  }
});

export default app;
