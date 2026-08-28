/**
 * レッスン報告とレッスン内容マスターで共通利用する識別子の解決処理。
 *
 * 通常プラン: "1" ... "28"
 * PROプラン: "Pro_バズ_1" など
 */

const PRO_CURRICULUM_RULES = [
  { prefix: 'Pro_収益', keywords: ['収益の最大化', 'マネタイズ戦略'] },
  { prefix: 'Pro_V体質化', keywords: ['V体質化'] },
  { prefix: 'Pro_案件', keywords: ['企業案件獲得術'] },
  { prefix: 'Pro_バズ', keywords: ['バズコンテンツ量産術'] },
  { prefix: 'Pro_動画アド', keywords: ['動画編集コース（アドバンス編）'] },
  { prefix: 'Pro_動画', keywords: ['動画編集コース（標準編）'] },
  { prefix: 'Pro_伸び', keywords: ['YouTube活動「伸び」', 'YouTube活動『伸び』'] }
];

function cleanText(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function findProPrefix(text) {
  const normalized = cleanText(text);
  return PRO_CURRICULUM_RULES.find(rule =>
    rule.keywords.some(keyword => normalized.includes(cleanText(keyword)))
  )?.prefix || null;
}

function normalizePositiveInteger(value) {
  const normalized = cleanText(value);
  if (!/^\d+$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isInteger(number) && number > 0 ? String(number) : null;
}

/** DBや一括登録で生じた表記揺れを比較可能なキーへ寄せる。 */
export function normalizeLessonKey(value) {
  let normalized = cleanText(value);
  if (!normalized) return null;

  // 例: "3,Pro_『伸び』_2"。先頭番号は旧一括登録時に混入した値。
  if (normalized.includes(',')) {
    normalized = normalized.slice(normalized.lastIndexOf(',') + 1).trim();
  }

  normalized = normalized
    .replace(/[『』「」]/g, '')
    .replace(/\(([B-E])\)$/i, '_$1')
    .replace(/\s+/g, '');

  const numeric = normalizePositiveInteger(normalized);
  if (numeric) return numeric;

  if (/^pro_/i.test(normalized)) {
    normalized = `Pro_${normalized.slice(4)}`;
  }
  return normalized;
}

export function buildProLessonKey(curriculum, textNumber) {
  const prefix = findProPrefix(curriculum);
  const number = normalizePositiveInteger(textNumber);
  return prefix && number ? `${prefix}_${number}` : null;
}

function getNextLessonKey(currentKey) {
  const numeric = normalizePositiveInteger(currentKey);
  if (numeric) return String(Number(numeric) + 1);

  const proMatch = String(currentKey || '').match(/^(Pro_.+_)(\d+)$/);
  if (!proMatch) return null;
  return `${proMatch[1]}${Number(proMatch[2]) + 1}`;
}

export function formatLessonLabel(lessonKey) {
  if (!lessonKey) return '（未確認）';
  return /^\d+$/.test(String(lessonKey)) ? `${lessonKey}回目` : String(lessonKey);
}

/** レッスン報告または手動入力から、保存・マスター検索に使うキーを解決する。 */
export function resolveLessonReference(source) {
  if (!source) return null;

  const rawLessonNumber = cleanText(source.lesson_number ?? source.lessonNumber);
  let lessonKey;

  if (rawLessonNumber === 'PROプラン') {
    lessonKey = buildProLessonKey(
      source.pro_curriculum ?? source.proCurriculum,
      source.pro_text_number ?? source.proTextNumber
    );
  } else {
    lessonKey = normalizeLessonKey(rawLessonNumber);
  }

  if (
    !lessonKey ||
    (!/^\d+$/.test(lessonKey) && !/^Pro_.+_\d+(?:_[B-E])?$/.test(lessonKey))
  ) {
    return null;
  }
  return {
    lessonKey,
    nextLessonKey: getNextLessonKey(lessonKey),
    lessonLabel: formatLessonLabel(lessonKey),
    isPro: lessonKey.startsWith('Pro_')
  };
}

function getProVariant(text, fallbackKey) {
  const lessonMatch = cleanText(text).match(/Lesson\s*\d+([A-E])/i);
  const fallbackMatch = String(fallbackKey || '').match(/(?:_|\()([B-E])\)?$/i);
  const variant = (lessonMatch?.[1] || fallbackMatch?.[1] || '').toUpperCase();
  // Aは各コースの基本キーとして扱い、B〜Eだけをサフィックスにする。
  return variant && variant !== 'A' ? `_${variant}` : '';
}

/** 旧一括登録で壊れたキーを、本文のコース名・Lesson番号から復元する。 */
export function deriveLessonContentKey(row) {
  if (!row) return null;
  const storedKey = normalizeLessonKey(row.lesson_number);
  if (!storedKey || /^\d+$/.test(storedKey)) return storedKey;

  const sourceText = `${row.content || ''}\n${row.title || ''}`;
  const prefix = findProPrefix(sourceText) || findProPrefix(storedKey);
  const lessonMatch = cleanText(sourceText).match(/Lesson\s*(\d+)/i);
  const number = lessonMatch?.[1]
    ? normalizePositiveInteger(lessonMatch[1])
    : normalizePositiveInteger(storedKey.match(/_(\d+)(?:_[B-E])?$/)?.[1]);

  if (!prefix || !number) return storedKey;
  return `${prefix}_${number}${getProVariant(sourceText, storedKey)}`;
}

export function buildLessonContentIndex(rows) {
  const index = new Map();
  const aliases = [];
  for (const row of rows || []) {
    const storedKey = normalizeLessonKey(row.lesson_number);
    const isLegacyCombinedKey = String(row.lesson_number || '').includes(',');
    // 正式な Pro_... キーはマスターの識別子として優先する。
    // カンマ混入行だけは本文から正しいキーを復元する。
    const key = isLegacyCombinedKey ? deriveLessonContentKey(row) : storedKey;
    if (!key) continue;
    if (!index.has(key)) index.set(key, row);

    const contentKey = deriveLessonContentKey(row);
    if (!isLegacyCombinedKey && contentKey && contentKey !== storedKey) {
      aliases.push({ key: contentKey, row });
      console.warn(
        `[LessonContents] Key/content mismatch: stored=${storedKey}, content=${contentKey}. Registering a compatibility alias.`
      );
    }
  }

  // 正式キーの登録後に別名を追加することで、将来正式な行が追加された場合はそちらを優先する。
  for (const alias of aliases) {
    if (!index.has(alias.key)) index.set(alias.key, alias.row);
  }
  return index;
}

export function getLessonContent(index, lessonKey) {
  return lessonKey ? index.get(normalizeLessonKey(lessonKey)) || null : null;
}

export function getProCurriculumRules() {
  return PRO_CURRICULUM_RULES.map(rule => ({
    prefix: rule.prefix,
    keywords: [...rule.keywords]
  }));
}
