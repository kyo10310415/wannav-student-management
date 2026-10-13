import { getStudentNotionReadClient } from './notionService.js';
import { DEFAULT_REVIEW_MAPPING, PROFILE_KEYS, reviewError } from './extensionReviewRules.js';

export function ageFromBirthDate(value, now = new Date()) {
  if (typeof value !== 'string' || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  // Notion date properties may include an ISO timestamp. Treat the written date as the birthday.
  const iso = !match && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
    ? value.slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  const parts = match || iso;
  if (!parts) return null;
  const [year,month,day] = parts.slice(1).map(Number);
  const date = new Date(Date.UTC(year,month-1,day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 || date.getUTCDate() !== day) return null;
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const currentYear = today.getUTCFullYear(), currentMonth = today.getUTCMonth()+1, currentDay = today.getUTCDate();
  const age = currentYear - year - (currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0);
  return age >= 0 && age <= 120 ? age : null;
}

export function reviewPropertyValue(property) {
  if (!property) return null;
  const text = items => (items || []).map(item => item.plain_text || item.text?.content || '').join('');
  switch (property.type) {
    case 'title': return text(property.title) || null;
    case 'rich_text': return text(property.rich_text) || null;
    case 'number': return property.number;
    case 'checkbox': return property.checkbox;
    case 'select': return property.select?.name || null;
    case 'status': return property.status?.name || null;
    case 'multi_select': return property.multi_select?.map(v => v.name) || null;
    case 'date': return property.date?.start || null;
    case 'formula': return reviewPropertyValue(property.formula);
    case 'rollup': return property.rollup?.type === 'array' ? property.rollup.array.map(reviewPropertyValue).filter(v => v !== null).flat() : reviewPropertyValue(property.rollup);
    case 'relation': return property.relation?.map(v => v.id) || null;
    default: return null;
  }
}

export async function fetchReviewNotion(pageId, mapping, notion = getStudentNotionReadClient(), { inspectBlocks = false, now = new Date() } = {}) {
  if (!mapping || Object.keys(mapping).length === 0) mapping = DEFAULT_REVIEW_MAPPING;
  try {
    let requests = 0;
    async function read(work) {
      if (++requests > 100) throw reviewError('Notion取得リクエスト数が安全上限を超えています', 413);
      return work();
    }
    const page = await read(() => notion.pages.retrieve({ page_id: pageId }));
    const configuredDatabase = (process.env.NOTION_STUDENT_DB_ID || '').replaceAll('-', '').toLowerCase();
    if (configuredDatabase && String(page.parent?.database_id || '').replaceAll('-', '').toLowerCase() !== configuredDatabase) throw reviewError('指定ページは生徒データベースに属していません');
    const properties = page.properties || {};
    const profile = {};
    const blockValues = new Map();
    let visited = 0;
    async function walk(id, depth = 0, section = '') {
      if (depth > 20) throw reviewError('Notion本文の階層が上限を超えています');
      let cursor;
      const cursors = new Set();
      do {
        const batch = await read(() => notion.blocks.children.list({ block_id: id, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }));
        for (const block of batch.results) {
          if (++visited > 2000) throw reviewError('Notion本文の取得上限を超えています');
          const text = (block[block.type]?.rich_text || []).map(t => t.plain_text || t.text?.content || '').join('');
          if (/^heading_/.test(block.type)) section = text.trim();
          if (section && text && !/^heading_/.test(block.type)) {
            const values = blockValues.get(section) || [];
            values.push({ text, list: ['bulleted_list_item', 'numbered_list_item'].includes(block.type) });
            blockValues.set(section, values);
          }
          for (const entry of Object.values(mapping || {})) {
            if (entry.source === 'block' && [':','：'].some(separator => text.startsWith(entry.name + separator))) blockValues.set(entry.name, [{ text: text.slice(entry.name.length + 1), list: false }]);
          }
          if (block.has_children) await walk(block.id, depth + 1, section || text);
        }
        cursor = batch.has_more ? batch.next_cursor : null;
        if (batch.has_more && (!cursor || cursors.has(cursor))) throw reviewError('Notion本文のページネーションが不正です');
        if (cursor) cursors.add(cursor);
      } while (cursor);
    }
    if (inspectBlocks || Object.values(mapping || {}).some(entry => entry.source === 'block')) await walk(pageId);
    for (const key of PROFILE_KEYS) {
      const entry = mapping?.[key];
      let value = null;
      if (entry?.source === 'property') {
        let property = properties[entry.name];
        if (property && ['relation', 'rich_text', 'title'].includes(property.type) && (property.has_more || (property[property.type]?.length || 0) >= 25)) {
          const items = [];
          let cursor;
          do {
            const response = await read(() => notion.pages.properties.retrieve({ page_id: pageId, property_id: property.id, ...(cursor ? { start_cursor: cursor } : {}) }));
            if (response.object !== 'list') break;
            items.push(...response.results.map(item => item[property.type]));
            if (items.length > 500) throw reviewError('Notionプロパティの取得上限を超えています');
            cursor = response.has_more ? response.next_cursor : null;
            if (response.has_more && !cursor) throw reviewError('Notionプロパティの続きを取得できません');
          } while (cursor);
          property = { ...property, [property.type]: items };
        }
        value = reviewPropertyValue(property);
        if (property?.type === 'relation' && Array.isArray(value)) {
          if (value.length > 50) throw reviewError('リレーションの取得上限を超えています');
          const resolved = [];
          for (const id of value) {
            const related = await read(() => notion.pages.retrieve({ page_id: id }));
            const title = Object.values(related.properties || {}).find(p => p.type === 'title');
            const text = reviewPropertyValue(title);
            if (text) resolved.push(text);
          }
          value = resolved.length ? resolved : null;
        }
      } else if (entry?.source === 'block') {
        const rows = blockValues.get(entry.name) || [];
        value = key === 'companyReasons' && rows.some(row => row.list)
          ? rows.filter(row => row.list).map(row => row.text)
          : rows.map(row => row.text).join('\n') || null;
      }
      if (key === 'age' && (entry?.transform === 'ageFromBirthDate' || entry?.name === '生年月日')) value = ageFromBirthDate(value, now);
      else if (key === 'age' && typeof value === 'string' && /^\d{1,3}(?:歳)?$/.test(value.trim())) value = Number(value.trim().replace('歳', ''));
      if (key === 'companyReasons' && typeof value === 'string') {
        const lines = value.split('\n').map(line => line.trim()).filter(Boolean);
        if (lines.length && lines.every(line => /^(?:[-•・]|\d+[.)、])\s*\S/.test(line))) value = lines.map(line => line.replace(/^(?:[-•・]|\d+[.)、])\s*/, ''));
      }
      value = value ?? null;
      if (JSON.stringify(value).length > 20000) throw reviewError('Notion項目が取得上限を超えています');
      profile[key] = value;
    }
    return { profile, studentId: reviewPropertyValue(properties['学籍番号']), studentName: reviewPropertyValue(properties['名前']),
      propertySchema: Object.entries(properties).map(([name, value]) => ({ name, type: value.type })), blockHeadings: [...blockValues.keys()] };
  } catch (error) {
    if (error.safe) throw error;
    throw reviewError('Notion情報を取得できません。ページ・生徒DB・Integration共有権限を確認してください', 502);
  }
}
