/**
 * Google Drive / Docs API サービス
 *
 * - 親フォルダ（LESSON_DRIVE_FOLDER_ID）の中から学籍番号フォルダを探す
 * - 子フォルダ内の Gemini メモファイルを日付でマッチング
 * - ファイル内の「文字起こし」タブのテキストを取得
 *
 * ファイル名例: WannaVレッスン予約 (○○) - 2026/07/01 20:43 JST - Gemini によるメモ
 */

import { google } from 'googleapis';

// ─── 認証クライアントの初期化（sheetsService.js と同じパターン） ───
function getAuthClient() {
  if (!process.env.GOOGLE_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_CREDENTIALS_JSON not found in environment variables');
  }
  const credString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
  let credentials;
  try {
    if (credString.startsWith('{') || credString.startsWith('[')) {
      credentials = JSON.parse(credString);
    } else {
      credentials = JSON.parse(Buffer.from(credString, 'base64').toString('utf-8'));
    }
  } catch (e) {
    throw new Error('Failed to parse GOOGLE_CREDENTIALS_JSON: ' + e.message);
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/documents.readonly',
    ],
  });
}

/**
 * 日付文字列をファイル名から抽出する
 * "WannaVレッスン予約 (○○) - 2026/07/01 20:43 JST - Gemini によるメモ"
 *  → "2026/07/01" → Date オブジェクト（JSTとして扱う）
 */
function extractDateFromFileName(fileName) {
  // YYYY/MM/DD or YYYY-MM-DD
  const m = fileName.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00+09:00`);
}

/**
 * YYYY-MM-DD 文字列から Date (JST) を作成
 */
function dateFromStr(str) {
  return new Date(`${str}T00:00:00+09:00`);
}

/**
 * 学籍番号に対応する子フォルダIDを返す
 * @param {object} drive  - google.drive インスタンス
 * @param {string} parentFolderId - 親フォルダID
 * @param {string} studentId       - 学籍番号
 */
async function findStudentFolder(drive, parentFolderId, studentId) {
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 500,
  });
  const folders = res.data.files || [];
  // フォルダ名が学籍番号と一致するものを探す（完全一致 or 前方一致）
  const exact = folders.find(f => f.name === studentId);
  if (exact) return exact.id;
  const partial = folders.find(f => f.name.startsWith(studentId));
  return partial ? partial.id : null;
}

/**
 * 子フォルダ内の Gemini メモファイルを検索し、日付でフィルタ
 * @param {object} drive
 * @param {string} folderId
 * @param {string} targetDateStr  - YYYY-MM-DD (今日)
 * @returns {Array<{id, name, date}>}
 */
async function findMemoFilesForDate(drive, folderId, targetDateStr) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
    fields: 'files(id, name, createdTime, modifiedTime)',
    pageSize: 200,
    orderBy: 'createdTime desc',
  });
  const files = res.data.files || [];

  const today = dateFromStr(targetDateStr);
  // 前日
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayStr     = today.toISOString().slice(0, 10);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const matched = [];
  for (const file of files) {
    const fileDate = extractDateFromFileName(file.name);
    if (!fileDate) continue;
    const fileDateStr = fileDate.toISOString().slice(0, 10);
    if (fileDateStr === todayStr || fileDateStr === yesterdayStr) {
      matched.push({ id: file.id, name: file.name, date: fileDateStr });
    }
  }
  return matched;
}

/**
 * tabs 配列（ネスト含む）をフラットに展開するヘルパー
 * Google Docs のタブは childTabs でネストしている場合がある
 */
function flattenTabs(tabs) {
  const result = [];
  function walk(list) {
    for (const t of (list || [])) {
      result.push(t);
      if (t.childTabs?.length) walk(t.childTabs);
    }
  }
  walk(tabs);
  return result;
}

/**
 * Google Docs ファイルから「文字起こし」タブのテキストを取得
 *
 * Google Docs の "タブ" は documentTabs API (2024〜) で取得。
 * ネスト（childTabs）を再帰的に展開して「文字起こし」タブを探す。
 * タブが存在しない／見つからない場合は本文全体を返す。
 */
async function getTranscriptFromDoc(docs, fileId) {
  // documentTabs を含むフルドキュメントを取得
  let docData;
  try {
    const res = await docs.documents.get({
      documentId: fileId,
      includeTabsContent: true,
    });
    docData = res.data;
  } catch (e) {
    // includeTabsContent 非対応の場合はフォールバック
    const res = await docs.documents.get({ documentId: fileId });
    docData = res.data;
  }

  // タブが存在する場合（ネスト含めてフラット展開して探す）
  const rawTabs = docData.tabs || [];
  if (rawTabs.length > 0) {
    const allTabs = flattenTabs(rawTabs);

    console.log(`[Drive] Document tabs found: ${allTabs.map(t => `"${t.tabProperties?.title || '(無題)'}"`).join(', ')}`);

    // 「文字起こし」という名前のタブを優先
    const transcriptTab = allTabs.find(t =>
      (t.tabProperties?.title || '').includes('文字起こし')
    );

    if (transcriptTab) {
      console.log(`[Drive] Using tab: "${transcriptTab.tabProperties?.title}"`);
      const body = transcriptTab.documentTab?.body;
      if (body) return extractTextFromBody(body);
    }

    // 「文字起こし」タブが見つからない場合は末尾タブ（フォールバック）
    console.warn(`[Drive] "文字起こし" tab not found, falling back to last tab`);
    const lastTab = allTabs[allTabs.length - 1];
    const body = lastTab?.documentTab?.body;
    if (body) return extractTextFromBody(body);
  }

  // タブがない場合はドキュメント本文を使用
  console.warn(`[Drive] No tabs found, using document body`);
  const body = docData.body;
  if (body) return extractTextFromBody(body);

  return '';
}

/**
 * Docs body → プレーンテキスト
 */
function extractTextFromBody(body) {
  const lines = [];
  for (const elem of (body.content || [])) {
    if (elem.paragraph) {
      const text = (elem.paragraph.elements || [])
        .map(e => e.textRun?.content || '')
        .join('');
      lines.push(text);
    } else if (elem.table) {
      for (const row of (elem.table.tableRows || [])) {
        for (const cell of (row.tableCells || [])) {
          lines.push(...(cell.content || []).map(ce =>
            (ce.paragraph?.elements || []).map(e => e.textRun?.content || '').join('')
          ));
        }
      }
    }
  }
  return lines.join('').trim();
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * 学籍番号 × 日付 で「文字起こし」テキストを取得する
 *
 * @param {string} studentId       - 学籍番号
 * @param {string} lessonDateStr   - YYYY-MM-DD (今日のレッスン日)
 * @param {string} [parentFolderId] - 親フォルダID（省略時は環境変数 LESSON_DRIVE_FOLDER_ID）
 * @returns {{ transcript: string, fileId: string, fileName: string } | null}
 */
export async function fetchTranscript(studentId, lessonDateStr, parentFolderId) {
  const folderId = parentFolderId || process.env.LESSON_DRIVE_FOLDER_ID || '18YfaP1CrW5Lq_sAeVAR56tIRZR3GwMDS';

  const auth  = getAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const docs  = google.docs({ version: 'v1', auth });

  // 1. 学籍番号フォルダを探す
  const studentFolderId = await findStudentFolder(drive, folderId, studentId);
  if (!studentFolderId) {
    console.warn(`[Drive] Student folder not found for studentId="${studentId}" in parent="${folderId}"`);
    return null;
  }

  // 2. 今日・前日のメモファイルを探す
  const files = await findMemoFilesForDate(drive, studentFolderId, lessonDateStr);
  if (files.length === 0) {
    console.warn(`[Drive] No memo files found for studentId="${studentId}" date="${lessonDateStr}"`);
    return null;
  }

  // 日付が一番新しいものを使用（重複防止: 同じ日付なら最初の1件）
  const seen = new Set();
  const unique = [];
  for (const f of files) {
    if (!seen.has(f.date)) { seen.add(f.date); unique.push(f); }
  }
  // 当日優先 → 前日
  unique.sort((a, b) => b.date.localeCompare(a.date));
  const target = unique[0];

  // 3. ドキュメントから「文字起こし」タブのテキストを取得
  const transcript = await getTranscriptFromDoc(docs, target.id);

  return {
    transcript,
    fileId:   target.id,
    fileName: target.name,
    fileDate: target.date,
  };
}
