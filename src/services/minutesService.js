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
 *   - summary              : 今日の成果・振り返り（箇条書き3〜5点、深掘りした自然な文章）
 *   - youtube_feedback     : YouTubeの配信に関するフィードバック・アドバイス
 *   - x_feedback           : X（旧Twitter）の運用に関するフィードバック・アドバイス
 *   - next_action          : ネクストアクション・ミッション（次回までの課題・行動）
 *   - notes                : その他メモ
 *
 * @param {string} transcript       文字起こしテキスト
 * @param {string} studentName      生徒名（敬称なし）
 * @param {string} todayRawContent  lesson_contents の生テキスト（今回）
 * @param {string} nextRawContent   lesson_contents の生テキスト（次回）
 * @returns {{ today_lesson_summary, next_lesson_summary, summary, youtube_feedback, x_feedback, next_action, notes }}
 */
export async function generateMinutesContent(
  transcript,
  studentName,
  todayRawContent,
  nextRawContent,
) {
  const client = getOpenAIClient();
  const studentNameSama = studentName ? `${studentName}様` : '生徒様';

  const systemPrompt = `あなたはVTuberスクールの講師です。自分が担当したレッスンの議事録を、講師自身の視点（一人称：私）で作成してください。
文体は「〜しました」「〜を行いました」「〜についてアドバイスしました」のような、講師が書いたナチュラルな文章にしてください。
第三者視点（「〜様は〜しました」のみ）ではなく、講師目線で生徒とのやり取りや指導内容を書いてください。

レッスンの文字起こしと、レッスンマスターの情報をもとに、以下の7つを日本語で出力してください。

【重要】箇条書きが必要な項目は、各項目を「\\n・」（改行＋中点）で区切って出力してください。カンマ（,）で区切らないでください。
【重要】各箇条書き項目は「端的な一言」ではなく、背景・理由・具体的なやり取りを含めた2〜3文程度の自然な文章で書いてください。

1. today_lesson_summary（今回のレッスン内容）:
   レッスンマスターの「今回のレッスン内容」をもとに、実際にレッスンで扱った内容を
   2〜4行の文章でまとめてください。
   何を・なぜ・どのように扱ったかがわかるように書いてください。
   マスターの詳細な手順・ミッション・予約URLなどの余分な情報は含めないでください。
   講師目線の文体で書いてください（例：「〜について指導しました。〜の点が特に重要だったため、一緒に確認しました」）。

2. next_lesson_summary（次回レッスン予定）:
   レッスンマスターの「次回のレッスン内容」をもとに、次回予定を
   1〜3行の簡潔な文章でまとめてください。
   マスターの詳細な手順・ミッション・予約URLなどの余分な情報は含めないでください。
   講師目線の文体で書いてください（例：「次回は〜を予定しています」）。

3. summary（今日の成果・振り返り）:
   レッスンで指導したこと・生徒が実践したこと・気づきを3〜5点でまとめてください。
   各項目は改行＋「・」で区切ってください（カンマ区切りは禁止）。
   各項目は「〜しました」だけの一言で終わらせず、なぜそのアドバイスをしたか・生徒がどう反応したか・どんな背景があったかなど、具体的な内容を2〜3文で書いてください。
   生徒への敬称は必ず「様」を使ってください（例: 田中様）。
   YouTubeやXに関する個別フィードバックはここには含めず、4・5に記載してください。
   ネクストアクション・ミッションはここには含めず、6に記載してください。

4. youtube_feedback（YouTubeフィードバック）:
   文字起こしの中でYouTubeの配信・動画・チャンネル運営に関して私が行ったフィードバックや
   アドバイスをすべて抽出してください。
   各項目は改行＋「・」で区切ってください（カンマ区切りは禁止）。
   各項目は具体的な指摘内容・その理由・改善の方向性を含めた2〜3文で書いてください（「〜とアドバイスしました。なぜなら〜だからです」のように）。
   該当する発言が文字起こしにない場合は「なし」と記載してください。

5. x_feedback（X/Twitterフィードバック）:
   文字起こしの中でX（旧Twitter）の投稿・運用・企画に関して私が行ったフィードバックや
   アドバイスをすべて抽出してください。
   各項目は改行＋「・」で区切ってください（カンマ区切りは禁止）。
   各項目は具体的な指摘内容・その理由・改善の方向性を含めた2〜3文で書いてください。
   該当する発言が文字起こしにない場合は「なし」と記載してください。

6. next_action（ネクストアクション・ミッション）:
   文字起こしの中で、次回レッスンまでに生徒が取り組む課題・ミッション・宿題・行動項目を
   すべて抽出してください。
   各項目は改行＋「・」で区切ってください（カンマ区切りは禁止）。
   各項目は何をすべきか・なぜそれが重要か・どんな基準で完了とするかがわかるように書いてください。
   例：「デザイン4原則を意識したサムネイル画像を3枚作成する。視聴者が一目でテーマを理解できるデザインを意識してください、とお伝えしました」
   該当する内容が文字起こしにない場合は「なし」と記載してください。

7. notes（その他メモ）:
   YouTube・X・ネクストアクション以外の特記事項・次回への申し送り・懸念事項があれば記載してください。なければ「なし」。
   複数ある場合は改行＋「・」で区切ってください（カンマ区切りは禁止）。

必ずJSON形式で出力してください:
{"today_lesson_summary": "...", "next_lesson_summary": "...", "summary": "...", "youtube_feedback": "...", "x_feedback": "...", "next_action": "...", "notes": "..."}`;

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
      max_tokens: 2400,
    });

    const raw    = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(raw);
    return {
      today_lesson_summary: parsed.today_lesson_summary || '',
      next_lesson_summary:  parsed.next_lesson_summary  || '',
      summary:              parsed.summary               || '',
      youtube_feedback:     parsed.youtube_feedback      || 'なし',
      x_feedback:           parsed.x_feedback            || 'なし',
      next_action:          parsed.next_action           || 'なし',
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
    youtube_feedback,
    x_feedback,
    next_action,
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
    youtube_feedback,
    x_feedback,
    next_action,
    notes,
  });
}
