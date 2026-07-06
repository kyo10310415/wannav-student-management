/**
 * 議事録生成サービス
 * OpenAI GPT を使って文字起こしテキストから議事録を自動生成する
 */

import OpenAI from 'openai';

let _client = null;

function getOpenAIClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  _client = new OpenAI({ apiKey });
  return _client;
}

/**
 * テンプレート内のプレースホルダーを置換する
 */
export function applyTemplate(templateText, vars) {
  let result = templateText;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val ?? '');
  }
  return result;
}

/**
 * lesson_contents の生テキストから「表示用の短い要点」を抽出するヘルパー。
 *
 * lesson_contents.content には次のような形式で複数のブロックが入ることが多い:
 *   【レッスン内容】\n・...\n【次回レッスン】\n・...\n【ミッション】\n...
 *
 * このうち「【レッスン内容】」ブロックの箇条書きだけを抽出して返す。
 * ブロックが見つからない場合は title のみを返す。
 *
 * @param {string} title   lesson_contents.title
 * @param {string} content lesson_contents.content
 * @returns {string}
 */
function extractLessonSummary(title, content) {
  if (!content) return title || '';

  // 【レッスン内容】ブロックを抽出
  const lessonMatch = content.match(/【レッスン内容】([\s\S]*?)(?=【|$)/);
  if (lessonMatch) {
    const block = lessonMatch[1].trim();
    if (block) return title ? `${title}\n${block}` : block;
  }

  // ブロックが見つからなければタイトルだけ返す
  return title || '';
}

/**
 * OpenAI で文字起こしから議事録の各フィールドを生成する
 *
 * 生成する項目:
 *   - today_lesson_summary : 今回のレッスン内容（簡潔な要点）
 *   - next_lesson_summary  : 次回レッスン予定（簡潔な要点）
 *   - summary              : 今日の成果・振り返り（箇条書き3〜5点）
 *   - notes                : その他メモ
 *
 * @param {string} transcript       文字起こしテキスト
 * @param {string} studentName      生徒名（敬称なし）
 * @param {string} todayRawContent  lesson_contents の生テキスト（今回）
 * @param {string} nextRawContent   lesson_contents の生テキスト（次回）
 * @returns {{ today_lesson_summary, next_lesson_summary, summary, notes }}
 */
export async function generateMinutesContent(
  transcript,
  studentName,
  todayRawContent,
  nextRawContent,
) {
  const client = getOpenAIClient();
  const studentNameSama = studentName ? `${studentName}様` : '生徒様';

  const systemPrompt = `あなたはVTuberスクールのレッスン議事録を作成するアシスタントです。
レッスンの文字起こしと、レッスンマスターの情報をもとに、以下の4つを日本語で出力してください。

1. today_lesson_summary（今回のレッスン内容）:
   レッスンマスターの「今回のレッスン内容」をもとに、実際にレッスンで扱った内容を
   1〜3行の簡潔な文章でまとめてください。
   マスターの詳細な手順・ミッション・予約URLなどの余分な情報は含めないでください。

2. next_lesson_summary（次回レッスン予定）:
   レッスンマスターの「次回のレッスン内容」をもとに、次回予定を
   1〜3行の簡潔な文章でまとめてください。
   マスターの詳細な手順・ミッション・予約URLなどの余分な情報は含めないでください。

3. summary（今日の成果・振り返り）:
   レッスンで学んだこと・実践したこと・生徒の状況を3〜5点の箇条書きでまとめてください。
   生徒への敬称は必ず「様」を使ってください（例: 田中様）。

4. notes（その他メモ）:
   特記事項・次回への申し送り・懸念事項があれば記載してください。なければ「なし」。

必ずJSON形式で出力してください:
{"today_lesson_summary": "...", "next_lesson_summary": "...", "summary": "...", "notes": "..."}`;

  const userPrompt = `【生徒名】${studentNameSama}

【今回のレッスンマスター情報（参考）】
${todayRawContent || '（情報なし）'}

【次回のレッスンマスター情報（参考）】
${nextRawContent || '（情報なし）'}

【文字起こし】
${transcript.slice(0, 8000)}`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1200,
    });

    const raw    = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(raw);
    return {
      today_lesson_summary: parsed.today_lesson_summary || '',
      next_lesson_summary:  parsed.next_lesson_summary  || '',
      summary:              parsed.summary               || '',
      notes:                parsed.notes                 || '',
    };
  } catch (err) {
    console.error('[MinutesService] OpenAI error:', err.message);
    throw new Error('AI議事録生成に失敗しました: ' + err.message);
  }
}

/**
 * テンプレートを適用して最終的な議事録テキストを生成する
 *
 * @param {object} params
 *   templateText, studentName, studentId, lessonDate, lessonNumber,
 *   todayContent, nextContent, transcript
 * @returns {string} 完成した議事録テキスト
 */
export async function buildMinutesText(params) {
  const {
    templateText,
    studentName,
    studentId,
    lessonDate,
    lessonNumber,
    todayContent,   // lesson_contents の生テキスト（今回）
    nextContent,    // lesson_contents の生テキスト（次回）
    transcript,
  } = params;

  // AI で全フィールドを生成（生テキストをそのまま渡す）
  const {
    today_lesson_summary,
    next_lesson_summary,
    summary,
    notes,
  } = await generateMinutesContent(
    transcript,
    studentName,
    todayContent,
    nextContent,
  );

  // テンプレートに流し込む
  return applyTemplate(templateText, {
    student_name:         studentName  ? `${studentName}様` : '',
    student_id:           studentId    || '',
    lesson_date:          lessonDate   || '',
    lesson_number:        lessonNumber != null ? String(lessonNumber) : '（未確認）',
    today_lesson_content: today_lesson_summary || extractLessonSummary('', todayContent),
    next_lesson_content:  next_lesson_summary  || extractLessonSummary('', nextContent),
    summary,
    notes,
  });
}
