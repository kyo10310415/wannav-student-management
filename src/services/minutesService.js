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
 * {{student_name}}, {{student_id}}, {{lesson_date}}, {{lesson_number}},
 * {{today_lesson_content}}, {{next_lesson_content}},
 * {{summary}}, {{notes}}
 */
export function applyTemplate(templateText, vars) {
  let result = templateText;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val ?? '');
  }
  return result;
}

/**
 * OpenAI で文字起こしから「今日の成果・振り返り」「その他メモ」を生成する
 *
 * @param {string} transcript       - 文字起こしテキスト
 * @param {string} studentName      - 生徒名
 * @param {string} todayContent     - 今日のレッスン内容（マスターから）
 * @param {string} nextContent      - 次回のレッスン内容（マスターから）
 * @returns {{ summary: string, notes: string }}
 */
export async function generateMinutesContent(transcript, studentName, todayContent, nextContent) {
  const client = getOpenAIClient();

  // 敬称を「様」に統一
  const studentNameSama = studentName ? `${studentName}様` : '生徒様';

  const systemPrompt = `あなたはVTuberスクールのレッスン議事録を作成するアシスタントです。
レッスンの文字起こしテキストをもとに、議事録に必要な情報を抽出・整理してください。
以下の2点を日本語で出力してください：
1. summary（今日の成果・振り返り）: レッスンで学んだこと、実践したこと、生徒の状況を簡潔に3〜5点の箇条書きでまとめてください。生徒への敬称は必ず「様」を使ってください（例: 鈴木様）。
2. notes（その他メモ）: 特記事項、次回への申し送り、懸念事項などがあれば記載してください。なければ「なし」と記載してください。

必ずJSON形式で出力してください:
{"summary": "...", "notes": "..."}`;

  const userPrompt = `【生徒名】${studentNameSama}
【今回のレッスン内容】${todayContent || '（未設定）'}
【次回のレッスン内容】${nextContent || '（未設定）'}

【文字起こし】
${transcript.slice(0, 8000)}`; // トークン制限対応で先頭8000文字

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1000,
    });

    const raw = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(raw);
    return {
      summary: parsed.summary || '',
      notes:   parsed.notes   || '',
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
    todayContent,
    nextContent,
    transcript,
  } = params;

  // AI で summary / notes を生成
  const { summary, notes } = await generateMinutesContent(
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
    today_lesson_content: todayContent || '（未設定）',
    next_lesson_content:  nextContent  || '（未設定）',
    summary,
    notes,
  });
}
