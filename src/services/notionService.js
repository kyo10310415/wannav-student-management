import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_TOKEN });

/**
 * Fetch all students from Notion database
 */
export async function fetchStudents() {
  try {
    const response = await notion.databases.query({
      database_id: process.env.NOTION_STUDENT_DB_ID,
    });

    return response.results.map(page => {
      const props = page.properties;
      
      return {
        notion_page_id: page.id,
        student_id: getPropertyValue(props['学籍番号']),
        name: getPropertyValue(props['生徒名']),
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
 * Fetch all tutors from Notion database
 */
export async function fetchTutors() {
  try {
    const response = await notion.databases.query({
      database_id: process.env.NOTION_TUTOR_DB_ID,
    });

    return response.results.map(page => {
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

export { notion };
