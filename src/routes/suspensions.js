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
    
    const suspensions = await fetchSuspensionData();
    
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
