import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { client as discordClient } from '../src/services/discordService.js';
import {
  classifyFunnelDiscordMessages,
  resolveTutorBookingLink
} from '../src/services/funnelDiscordService.js';

after(() => discordClient.destroy());

function message(id, authorId, createdAt, content, bot = false) {
  return {
    id,
    author: { id: authorId, bot },
    createdAt: new Date(createdAt),
    content
  };
}

test('detects booking links from tutors and bots but not from the student', () => {
  const result = classifyFunnelDiscordMessages({
    messages: [
      message('student-link', 'student-1', '2026-09-02T00:00:00Z', 'https://booking.example/regular'),
      message('bot-link', 'bot-1', '2026-09-03T00:00:00Z', '予約はこちら https://booking.example/regular/', true)
    ],
    studentDiscordId: 'student-1',
    bookingUrl: 'https://booking.example/regular',
    bookingStartAt: new Date('2026-08-31T15:00:00Z'),
    bookingEndAt: new Date('2026-09-30T15:00:00Z')
  });

  assert.equal(result.bookingLinkSent, true);
  assert.equal(result.bookingMessageId, 'bot-link');
});

test('selects the assigned tutor booking URL for each lesson plan', () => {
  const baseStudent = {
    homeroom_tutor: 'Tutor A',
    booking_tutor_name: 'Tutor A',
    booking_user_id: 10,
    funnel_regular_booking_url: 'https://booking.example/tutor-a/regular',
    funnel_pro_booking_url: 'https://booking.example/tutor-a/pro'
  };

  assert.deepEqual(resolveTutorBookingLink({
    ...baseStudent,
    contract_plan: '通常プラン'
  }), {
    url: 'https://booking.example/tutor-a/regular',
    error: null
  });
  assert.deepEqual(resolveTutorBookingLink({
    ...baseStudent,
    contract_plan: 'PROプラン'
  }), {
    url: 'https://booking.example/tutor-a/pro',
    error: null
  });
});

test('reports missing tutor mapping and missing tutor-specific booking URLs', () => {
  assert.match(resolveTutorBookingLink({
    homeroom_tutor: 'Tutor B',
    booking_user_id: null
  }).error, /ユーザー管理に登録されていません/);

  assert.match(resolveTutorBookingLink({
    homeroom_tutor: 'Tutor C',
    booking_tutor_name: 'Tutor C',
    booking_user_id: 11,
    contract_plan: 'PROプラン',
    funnel_pro_booking_url: ''
  }).error, /Tutor C.*PROプランレッスン予約URLが未設定/);
});

test('separates student follow-up and tutor reminder during the seven-day window', () => {
  const result = classifyFunnelDiscordMessages({
    messages: [
      message('reaction-only', 'student-1', '2026-09-10T04:00:00Z', ''),
      message('tutor-reminder', 'tutor-1', '2026-09-11T04:00:00Z', 'ご確認をお願いします'),
      message('student-contact', 'student-1', '2026-09-12T04:00:00Z', '再予約します'),
      message('too-late', 'student-1', '2026-09-18T04:00:01Z', '遅れて連絡')
    ],
    studentDiscordId: 'student-1',
    bookingUrl: '',
    bookingStartAt: new Date('2026-08-31T15:00:00Z'),
    bookingEndAt: new Date('2026-09-30T15:00:00Z'),
    noShowEvents: [{
      id: 1,
      student_id: 'S-1',
      lesson_date: '2026-09-10',
      event_at: new Date('2026-09-10T04:00:00Z')
    }]
  });

  assert.equal(result.noShows[0].studentContacted, true);
  assert.equal(result.noShows[0].followupComplete, true);
  assert.equal(result.noShows[0].studentMessageId, 'student-contact');
  assert.equal(result.noShows[0].tutorReminderSent, true);
  assert.equal(result.noShows[0].tutorMessageId, 'tutor-reminder');
});

test('keeps a no-show follow-up pending until the seven-day window ends', () => {
  const result = classifyFunnelDiscordMessages({
    messages: [],
    studentDiscordId: 'student-1',
    bookingUrl: '',
    bookingStartAt: new Date('2026-09-01T00:00:00Z'),
    bookingEndAt: new Date('2026-10-01T00:00:00Z'),
    noShowEvents: [{
      id: 2,
      student_id: 'S-1',
      lesson_date: '2026-09-30',
      event_at: new Date('2026-09-30T13:00:00Z')
    }],
    now: new Date('2026-10-02T00:00:00Z')
  });

  assert.equal(result.noShows[0].studentContacted, false);
  assert.equal(result.noShows[0].followupComplete, false);
});
