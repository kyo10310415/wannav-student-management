import pg from 'pg';
const { Client } = pg;

const connectionString = 'postgresql://wannav_user:BUFKQLq8tY7g1VEkItmd04cHhrTPe2eq@dpg-d5kbgqvgi27c739nefs0-a.oregon-postgres.render.com/wannav_extension';

async function checkDatabase() {
  const client = new Client({ 
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  try {
    await client.connect();
    console.log('✅ 接続成功\n');
    
    // すべてのテーブルを表示
    console.log('========== テーブル一覧 ==========');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    tablesResult.rows.forEach(row => {
      console.log(`- ${row.table_name}`);
    });
    console.log('');
    
    // 学籍番号を含むカラムを検索
    console.log('========== 学籍番号を含むカラム ==========');
    const studentIdResult = await client.query(`
      SELECT table_name, column_name, data_type, character_maximum_length
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND (column_name ILIKE '%student%' OR column_name ILIKE '%学籍%' OR column_name ILIKE '%id%')
      ORDER BY table_name, ordinal_position;
    `);
    if (studentIdResult.rows.length === 0) {
      console.log('見つかりませんでした');
    } else {
      studentIdResult.rows.forEach(row => {
        console.log(`${row.table_name}.${row.column_name} (${row.data_type})`);
      });
    }
    console.log('');
    
    // レッスン開始日・継続月数を含むカラムを検索
    console.log('========== レッスン開始日・継続月数を含むカラム ==========');
    const lessonResult = await client.query(`
      SELECT table_name, column_name, data_type, character_maximum_length
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND (column_name ILIKE '%start%' OR column_name ILIKE '%開始%' 
          OR column_name ILIKE '%duration%' OR column_name ILIKE '%継続%'
          OR column_name ILIKE '%month%' OR column_name ILIKE '%created%')
      ORDER BY table_name, ordinal_position;
    `);
    if (lessonResult.rows.length === 0) {
      console.log('見つかりませんでした');
    } else {
      lessonResult.rows.forEach(row => {
        console.log(`${row.table_name}.${row.column_name} (${row.data_type})`);
      });
    }
    console.log('');
    
    // すべてのカラムを表示（最初のテーブルがあれば）
    if (tablesResult.rows.length > 0) {
      for (const tableRow of tablesResult.rows) {
        const tableName = tableRow.table_name;
        console.log(`========== ${tableName} テーブルの構造 ==========`);
        const columnsResult = await client.query(`
          SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
          FROM information_schema.columns 
          WHERE table_schema = 'public' 
            AND table_name = $1
          ORDER BY ordinal_position;
        `, [tableName]);
        columnsResult.rows.forEach(row => {
          const maxLen = row.character_maximum_length ? `(${row.character_maximum_length})` : '';
          const nullable = row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
          const defaultVal = row.column_default ? ` DEFAULT ${row.column_default}` : '';
          console.log(`  ${row.column_name}: ${row.data_type}${maxLen} ${nullable}${defaultVal}`);
        });
        console.log('');
        
        // サンプルデータを3件表示
        console.log(`========== ${tableName} サンプルデータ（最初の3件）==========`);
        try {
          const sampleResult = await client.query(`SELECT * FROM "${tableName}" LIMIT 3;`);
          console.log(JSON.stringify(sampleResult.rows, null, 2));
        } catch (e) {
          console.log('サンプルデータの取得に失敗:', e.message);
        }
        console.log('\n');
      }
    }
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
    console.error(error.stack);
  } finally {
    await client.end();
  }
}

checkDatabase();
