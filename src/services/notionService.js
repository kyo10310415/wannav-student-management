import { Client } from '@notionhq/client';

// Support for separate tokens for student and tutor databases
const studentNotion = new Client({ 
  auth: process.env.NOTION_STUDENT_API_TOKEN || process.env.NOTION_API_TOKEN 
});

const tutorNotion = new Client({ 
  auth: process.env.NOTION_TUTOR_API_TOKEN || process.env.NOTION_API_TOKEN 
});

/**
 * Fetch all students from Notion database (with pagination support)
 */
export async function fetchStudents() {
  try {
    let allResults = [];
    let hasMore = true;
    let startCursor = undefined;

    // Fetch all pages with pagination
    while (hasMore) {
      const response = await studentNotion.databases.query({
        database_id: process.env.NOTION_STUDENT_DB_ID,
        start_cursor: startCursor,
        page_size: 100, // Maximum page size
      });

      allResults = allResults.concat(response.results);
      hasMore = response.has_more;
      startCursor = response.next_cursor;

      console.log(`Fetched ${response.results.length} students, total so far: ${allResults.length}`);
    }

    console.log(`Finished fetching all ${allResults.length} students from Notion`);

    return allResults.map(page => {
      const props = page.properties;
      
      return {
        notion_page_id: page.id,
        student_id: getPropertyValue(props['学籍番号']),
        name: getPropertyValue(props['名前']),  // 修正: '生徒名' → '名前'
        status: getPropertyValue(props['ステータス']),
        contract_plan: getPropertyValue(props['契約プラン']),
        character_name: getPropertyValue(props['キャラクター名']),
        homeroom_tutor: getPropertyValue(props['担任Tutor'])
      };
    });
  } catch (error) {
    console.error('Error fetching students from Notion:', error);
    throw error;
  }
}

/**
 * Fetch all tutors from Notion database (with pagination support)
 */
export async function fetchTutors() {
  try {
    let allResults = [];
    let hasMore = true;
    let startCursor = undefined;

    // Fetch all pages with pagination
    while (hasMore) {
      const response = await tutorNotion.databases.query({
        database_id: process.env.NOTION_TUTOR_DB_ID,
        start_cursor: startCursor,
        page_size: 100, // Maximum page size
      });

      allResults = allResults.concat(response.results);
      hasMore = response.has_more;
      startCursor = response.next_cursor;

      console.log(`Fetched ${response.results.length} tutors, total so far: ${allResults.length}`);
    }

    console.log(`Finished fetching all ${allResults.length} tutors from Notion`);

    return allResults.map(page => {
      const props = page.properties;
      
      return {
        notion_page_id: page.id,
        employee_id: getPropertyValue(props['従業員ID']),
        name: getPropertyValue(props['氏名']),
        email: getPropertyValue(props['メールアドレス']),
        team: getPropertyValue(props['所属チーム']),
        notion_name: getPropertyValue(props['Notion名']),
        monthly_available_hours: getPropertyValue(props['月の業務可能時間'])
      };
    });
  } catch (error) {
    console.error('Error fetching tutors from Notion:', error);
    throw error;
  }
}

/**
 * Helper function to extract property value from Notion property object
 */
function getPropertyValue(property) {
  if (!property) return null;

  switch (property.type) {
    case 'title':
      return property.title?.[0]?.plain_text || null;
    case 'rich_text':
      return property.rich_text?.[0]?.plain_text || null;
    case 'number':
      return property.number;
    case 'select':
      return property.select?.name || null;
    case 'multi_select':
      return property.multi_select?.map(s => s.name).join(', ') || null;
    case 'date':
      return property.date?.start || null;
    case 'people':
      return property.people?.[0]?.name || null;
    case 'email':
      return property.email;
    case 'phone_number':
      return property.phone_number;
    case 'checkbox':
      return property.checkbox;
    case 'url':
      return property.url;
    case 'relation':
      return property.relation?.[0]?.id || null;
    default:
      return null;
  }
}

export { studentNotion, tutorNotion };
