import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLessonContentIndex,
  buildProLessonKey,
  deriveLessonContentKey,
  formatLessonLabel,
  getLessonContent,
  normalizeLessonKey,
  resolveLessonReference
} from '../src/services/lessonReferenceService.js';

test('resolves a regular lesson using string keys', () => {
  const reference = resolveLessonReference({ lesson_number: '05' });

  assert.equal(reference.lessonKey, '5');
  assert.equal(reference.nextLessonKey, '6');
  assert.equal(reference.lessonLabel, '5回目');
  assert.equal(reference.isPro, false);
});

test('resolves PRO curriculum and text number to a canonical key', () => {
  const reference = resolveLessonReference({
    lesson_number: 'PROプラン',
    pro_curriculum: '【急成長】YouTubeバズコンテンツ量産術',
    pro_text_number: '1'
  });

  assert.equal(reference.lessonKey, 'Pro_バズ_1');
  assert.equal(reference.nextLessonKey, 'Pro_バズ_2');
  assert.equal(reference.lessonLabel, 'Pro_バズ_1');
  assert.equal(buildProLessonKey('【V体質化】 収益を生むグッズ販売戦略', 4), 'Pro_V体質化_4');
  assert.equal(buildProLessonKey('【特化スキル】動画編集コース（標準編）', 2), 'Pro_動画_2');
});

test('normalizes legacy PRO keys imported with a numeric prefix', () => {
  assert.equal(normalizeLessonKey('3,Pro_『伸び』_2'), 'Pro_伸び_2');
  assert.equal(normalizeLessonKey('8,Pro_『伸び』_8(B)'), 'Pro_伸び_8_B');
});

test('rejects unknown free-form lesson identifiers', () => {
  assert.equal(resolveLessonReference({ lesson_number: '不明なレッスン' }), null);
  assert.equal(resolveLessonReference({ lesson_number: 'PROプラン' }), null);
});

test('uses an explicit PRO source key and registers a content-based compatibility alias', () => {
  const wrongKeyRow = {
    lesson_number: 'Pro_バズ_1',
    title: 'YouTubeバズコンテンツ量産術 Lesson 3',
    content: '【レッスン内容】\nYouTubeバズコンテンツ量産術 Lesson 3\n内容'
  };
  const index = buildLessonContentIndex([wrongKeyRow]);

  assert.equal(deriveLessonContentKey(wrongKeyRow), 'Pro_バズ_3');
  assert.equal(getLessonContent(index, 'Pro_バズ_1'), wrongKeyRow);
  assert.equal(getLessonContent(index, 'Pro_バズ_3'), wrongKeyRow);
});

test('prefers a real canonical row over a compatibility alias', () => {
  const legacyAliasRow = {
    lesson_number: 'Pro_バズ_1',
    title: 'バズコンテンツ量産術 Lesson 3',
    content: 'バズコンテンツ量産術 Lesson 3'
  };
  const canonicalRow = {
    lesson_number: 'Pro_バズ_3',
    title: '正式なLesson 3',
    content: 'バズコンテンツ量産術 Lesson 3'
  };
  const index = buildLessonContentIndex([legacyAliasRow, canonicalRow]);

  assert.equal(getLessonContent(index, 'Pro_バズ_1'), legacyAliasRow);
  assert.equal(getLessonContent(index, 'Pro_バズ_3'), canonicalRow);
});

test('uses the canonical key to find regular and PRO master rows', () => {
  const rows = [
    { lesson_number: '5', title: '通常5', content: '内容' },
    {
      lesson_number: '1,Pro_伸び_1',
      title: 'YouTube活動「伸び」の再設計図 Lesson 1',
      content: 'YouTube活動「伸び」の再設計図 Lesson 1'
    }
  ];
  const index = buildLessonContentIndex(rows);

  assert.equal(getLessonContent(index, 5)?.title, '通常5');
  assert.equal(getLessonContent(index, 'Pro_伸び_1')?.title, rows[1].title);
  assert.equal(formatLessonLabel('Pro_伸び_1'), 'Pro_伸び_1');
});

test('retrieves current and next PRO lesson content from a report', () => {
  const rows = [
    { lesson_number: 'Pro_バズ_1', title: 'バズ1', content: 'バズコンテンツ量産術 Lesson 1' },
    { lesson_number: 'Pro_バズ_2', title: 'バズ2', content: 'バズコンテンツ量産術 Lesson 2' }
  ];
  const reference = resolveLessonReference({
    lesson_number: 'PROプラン',
    pro_curriculum: '【急成長】YouTubeバズコンテンツ量産術',
    pro_text_number: '1'
  });
  const index = buildLessonContentIndex(rows);

  assert.equal(getLessonContent(index, reference.lessonKey)?.title, 'バズ1');
  assert.equal(getLessonContent(index, reference.nextLessonKey)?.title, 'バズ2');
});
