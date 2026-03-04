import { Hono } from 'hono';
import pool from '../db/connection.js';
import { getExtensionPool } from '../db/extensionConnection.js';

const app = new Hono();

/**
 * GET /api/database/stats
 * Get database usage statistics
 */
app.get('/stats', async (c) => {
  try {
    const stats = {
      mainDatabase: {},
      extensionDatabase: {}
    };

    // Main Database Statistics
    try {
      // Get database size
      const dbSizeResult = await pool.query(`
        SELECT pg_database_size(current_database()) as size;
      `);
      const dbSizeBytes = parseInt(dbSizeResult.rows[0].size);
      stats.mainDatabase.totalSize = formatBytes(dbSizeBytes);
      stats.mainDatabase.totalSizeBytes = dbSizeBytes;

      // Get table sizes
      const tableSizeResult = await pool.query(`
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
          pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
      `);
      stats.mainDatabase.tables = tableSizeResult.rows;

      // Get row counts
      const rowCountResult = await pool.query(`
        SELECT 
          'students' as table_name,
          COUNT(*) as row_count
        FROM students
        UNION ALL
        SELECT 'tutors', COUNT(*) FROM tutors
        UNION ALL
        SELECT 'lessons', COUNT(*) FROM lessons
        UNION ALL
        SELECT 'schedules', COUNT(*) FROM schedules
        UNION ALL
        SELECT 'absence_requests', COUNT(*) FROM absence_requests
        UNION ALL
        SELECT 'helper_requests', COUNT(*) FROM helper_requests
        UNION ALL
        SELECT 'users', COUNT(*) FROM users;
      `);
      stats.mainDatabase.rowCounts = rowCountResult.rows;

      // Calculate total rows
      stats.mainDatabase.totalRows = rowCountResult.rows.reduce(
        (sum, row) => sum + parseInt(row.row_count), 
        0
      );

    } catch (error) {
      console.error('Error fetching main database stats:', error);
      stats.mainDatabase.error = error.message;
    }

    // Extension Database Statistics (if available)
    const extensionDbPool = getExtensionPool();
    if (extensionDbPool) {
      try {
        const extDbSizeResult = await extensionDbPool.query(`
          SELECT pg_database_size(current_database()) as size;
        `);
        const extDbSizeBytes = parseInt(extDbSizeResult.rows[0].size);
        stats.extensionDatabase.totalSize = formatBytes(extDbSizeBytes);
        stats.extensionDatabase.totalSizeBytes = extDbSizeBytes;

        const extTableSizeResult = await extensionDbPool.query(`
          SELECT 
            schemaname,
            tablename,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
            pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
          FROM pg_tables
          WHERE schemaname = 'public'
          ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
        `);
        stats.extensionDatabase.tables = extTableSizeResult.rows;

        const extRowCountResult = await extensionDbPool.query(`
          SELECT 
            'student_extensions' as table_name,
            COUNT(*) as row_count
          FROM student_extensions;
        `);
        stats.extensionDatabase.rowCounts = extRowCountResult.rows;
        stats.extensionDatabase.totalRows = parseInt(extRowCountResult.rows[0].row_count);

      } catch (error) {
        console.error('Error fetching extension database stats:', error);
        stats.extensionDatabase.error = error.message;
      }
    } else {
      stats.extensionDatabase.error = 'Extension database not configured';
    }

    return c.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error fetching database stats:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * GET /api/database/connection-info
 * Get database connection pool information
 */
app.get('/connection-info', async (c) => {
  try {
    const info = {
      mainDatabase: {
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingClients: pool.waitingCount
      }
    };

    const extensionDbPool = getExtensionPool();
    if (extensionDbPool) {
      info.extensionDatabase = {
        totalConnections: extensionDbPool.totalCount,
        idleConnections: extensionDbPool.idleCount,
        waitingClients: extensionDbPool.waitingCount
      };
    }

    return c.json({
      success: true,
      data: info
    });

  } catch (error) {
    console.error('Error fetching connection info:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * Helper function to format bytes to human-readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default app;
