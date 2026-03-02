import 'dotenv/config';

// Mock getSheets function for testing
async function getStudentDiscordInfo(studentId) {
  try {
    const { google } = await import('googleapis');
    
    let credentials;
    
    try {
      if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
        
        if (credString.startsWith('{') || credString.startsWith('[')) {
          credentials = JSON.parse(credString);
        } else {
          try {
            const decoded = Buffer.from(credString, 'base64').toString('utf-8');
            credentials = JSON.parse(decoded);
          } catch (decodeError) {
            credentials = JSON.parse(credString);
          }
        }
      } else {
        throw new Error('GOOGLE_CREDENTIALS_JSON not found in environment variables');
      }
    } catch (error) {
      console.error('Error parsing Google credentials:', error);
      throw error;
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    const spreadsheetId = '1iqrAhNjW8jTvobkur5N_9r9uUWFHCKqrhxM72X5z-iM';
    const sheetName = '❶RAW_生徒様情報';
    
    console.log(`\nFetching data from Google Sheets...`);
    console.log(`Spreadsheet ID: ${spreadsheetId}`);
    console.log(`Sheet Name: ${sheetName}`);
    console.log(`Range: B2:M`);
    
    // Fetch data from Google Sheets (B, G, M columns)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!B2:M`,
    });

    const rows = response.data.values || [];
    console.log(`\n✅ Successfully fetched ${rows.length} student records from Google Sheets\n`);

    // Show first 3 rows as sample
    console.log('Sample data (first 3 rows):');
    rows.slice(0, 3).forEach((row, index) => {
      console.log(`\nRow ${index + 1}:`);
      console.log(`  学籍番号 (B列): ${row[0] || '(empty)'}`);
      console.log(`  Discord ID (G列): ${row[5] || '(empty)'}`);
      console.log(`  チャットURL (M列): ${row[11] || '(empty)'}`);
    });

    // Find student by ID if provided
    if (studentId) {
      console.log(`\n\n🔍 Searching for student: ${studentId}`);
      const studentRow = rows.find(row => row[0] === studentId);
      
      if (!studentRow) {
        console.warn(`❌ Student ${studentId} not found in Google Sheets`);
        return null;
      }

      const discordId = studentRow[5] ? studentRow[5].trim() : null;
      const chatUrl = studentRow[11] ? studentRow[11].trim() : null;

      console.log(`\n✅ Student ${studentId} found:`);
      console.log(`  Discord ID: ${discordId || '(not set)'}`);
      console.log(`  Chat URL: ${chatUrl || '(not set)'}`);

      return {
        studentId: studentId,
        chatUrl: chatUrl,
        discordId: discordId
      };
    }
    
    return { totalRecords: rows.length };
  } catch (error) {
    console.error(`\n❌ Error fetching student Discord info:`, error.message);
    if (error.response?.data?.error) {
      console.error('API Error:', error.response.data.error);
    }
    throw error;
  }
}

// Test with a specific student ID or without to see sample data
const testStudentId = process.argv[2]; // Optional: pass student ID as argument

console.log('='.repeat(60));
console.log('Testing Student Discord Info Retrieval');
console.log('='.repeat(60));

if (testStudentId) {
  console.log(`\nTest mode: Searching for specific student ID: ${testStudentId}`);
} else {
  console.log(`\nTest mode: Showing sample data (first 3 records)`);
  console.log(`\nTip: Run with student ID to search: node test-student-discord-info.js STUDENT_ID`);
}

getStudentDiscordInfo(testStudentId)
  .then((result) => {
    console.log('\n' + '='.repeat(60));
    console.log('✅ Test completed successfully');
    console.log('='.repeat(60));
  })
  .catch((error) => {
    console.log('\n' + '='.repeat(60));
    console.log('❌ Test failed');
    console.log('='.repeat(60));
    process.exit(1);
  });
