import { Hono } from 'hono';
import { queryExtension, getExtensionPool } from '../db/extensionConnection.js';
import { getPool } from '../db/connection.js';

const app = new Hono();

/**
 * GET /api/extensions/stats
 * 延長管理の統計情報を取得
 */
app.get('/stats', async (c) => {
  try {
    console.log('📊 Fetching extension stats...');

    // Check if extension DB is configured
    const pool = getExtensionPool();
    if (!pool) {
      console.warn('⚠️ Extension database not configured (EXTENSION_DATABASE_URL missing)');
      return c.json({
        success: false,
        error: 'Extension database not configured. Please set EXTENSION_DATABASE_URL environment variable.'
      }, 503);
    }

    // 延長審査DBから全データ取得
    const extensionResult = await queryExtension(`
      SELECT 
        student_id,
        extension_certainty_1,
        hearing_status_1,
        examination_result_1,
        extension_certainty_2,
        hearing_status_2,
        examination_result_2
      FROM student_extensions
    `);

    const extensionData = extensionResult.rows;
    console.log('  延長審査DBレコード数:', extensionData.length);

    // メインDBから継続月数データ取得（アクティブ生徒のみ）
    const mainPool = getPool();
    const studentsResult = await mainPool.query(`
      SELECT 
        student_id,
        continued_months,
        homeroom_tutor,
        status,
        contract_plan
      FROM students
      WHERE status = 'アクティブ'
        AND contract_plan NOT IN ('永久会員', '在籍プラン')
    `);

    const students = studentsResult.rows;
    console.log('  アクティブ生徒数:', students.length);
    
    // Debug: Show sample student data
    if (students.length > 0) {
      console.log('  サンプル生徒データ:', {
        student_id: students[0].student_id,
        continued_months: students[0].continued_months,
        status: students[0].status,
        contract_plan: students[0].contract_plan
      });
    }
    
    // Debug: Count students by continued_months
    const monthsDistribution = {};
    students.forEach(s => {
      const months = s.continued_months || 0;
      monthsDistribution[months] = (monthsDistribution[months] || 0) + 1;
    });
    console.log('  継続月数分布:', monthsDistribution);

    // 延長審査データマップ作成
    const extensionMap = {};
    extensionData.forEach(ext => {
      extensionMap[ext.student_id] = ext;
    });

    // 各生徒のサイクル判定と統計計算
    let targetCount = 0; // 延長対象数（5ヶ月目と11ヶ月目のみ）
    let certaintyFilledCount = 0; // 延長確度記入済み（4ヶ月目と10ヶ月目のみ）
    let extensionCount = 0; // 延長数
    let withdrawalCount = 0; // 退会数
    let resultToldCount = 0; // 結果お伝え済み数（審査結果が入力されている）
    let remainingCount = 0; // 残弾数（高・中で未審査）

    // 1回目・2回目の統計
    let exam1stTargetCount = 0; // 5ヶ月目対象数
    let exam1stExtensionCount = 0; // 5ヶ月目延長数
    let exam2ndTargetCount = 0; // 11ヶ月目対象数
    let exam2ndExtensionCount = 0; // 11ヶ月目延長数

    students.forEach(student => {
      const months = student.continued_months;
      const ext = extensionMap[student.student_id];

      // サイクル判定
      const cycle = (months === 4 || months === 5) ? 1 : 2;
      const certainty = cycle === 1 ? ext?.extension_certainty_1 : ext?.extension_certainty_2;
      const examResult = cycle === 1 ? ext?.examination_result_1 : ext?.examination_result_2;

      // 延長対象数：5ヶ月目と11ヶ月目のみカウント
      if (months === 5 || months === 11) {
        targetCount++;

        // 審査結果がある場合
        if (examResult) {
          resultToldCount++;

          if (examResult === '延長') {
            extensionCount++;
          } else if (examResult === '退会') {
            withdrawalCount++;
          }
        }

        // 1回目・2回目の統計（審査月：5ヶ月目、11ヶ月目）
        if (months === 5) {
          exam1stTargetCount++;
          if (examResult === '延長') {
            exam1stExtensionCount++;
          }
        } else if (months === 11) {
          exam2ndTargetCount++;
          if (examResult === '延長') {
            exam2ndExtensionCount++;
          }
        }
      }

      // 延長確度記入済み：4ヶ月目と10ヶ月目のみカウント（「対象外」を除く）
      if ((months === 4 || months === 10) && certainty && certainty !== '対象外') {
        certaintyFilledCount++;
      }
    });

    // 残弾数 = 延長審査対象 - 延長数 - 退会数
    remainingCount = targetCount - extensionCount - withdrawalCount;

    // 延長率計算
    const extensionRate = targetCount > 0 
      ? Math.round((extensionCount / targetCount) * 100 * 10) / 10 
      : 0;

    // 延長率（対 結果お伝え）
    const extensionRateVsResult = resultToldCount > 0
      ? Math.round((extensionCount / resultToldCount) * 100 * 10) / 10
      : 0;

    // 1回目・2回目延長率
    const exam1stExtensionRate = exam1stTargetCount > 0
      ? Math.round((exam1stExtensionCount / exam1stTargetCount) * 100 * 10) / 10
      : 0;

    const exam2ndExtensionRate = exam2ndTargetCount > 0
      ? Math.round((exam2ndExtensionCount / exam2ndTargetCount) * 100 * 10) / 10
      : 0;

    const stats = {
      targetCount,
      certaintyFilledCount,
      extensionCount,
      withdrawalCount,
      extensionRate,
      extensionRateVsResult,
      remainingCount,
      resultToldCount,
      exam1st: {
        targetCount: exam1stTargetCount,
        extensionCount: exam1stExtensionCount,
        extensionRate: exam1stExtensionRate
      },
      exam2nd: {
        targetCount: exam2ndTargetCount,
        extensionCount: exam2ndExtensionCount,
        extensionRate: exam2ndExtensionRate
      }
    };

    console.log('  ✅ Stats calculated:', stats);

    return c.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('❌ Error fetching extension stats:', error);
    console.error('Error stack:', error.stack);
    return c.json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, 500);
  }
});

/**
 * GET /api/extensions/by-tutor
 * Tutor別の延長管理対象生徒数を取得
 */
app.get('/by-tutor', async (c) => {
  try {
    console.log('👥 Fetching extension data by tutor...');

    // Check if extension DB is configured
    const pool = getExtensionPool();
    if (!pool) {
      console.warn('⚠️ Extension database not configured (EXTENSION_DATABASE_URL missing)');
      return c.json({
        success: false,
        error: 'Extension database not configured. Please set EXTENSION_DATABASE_URL environment variable.'
      }, 503);
    }

    // 延長審査DBから全データ取得
    const extensionResult = await queryExtension(`
      SELECT 
        student_id,
        extension_certainty_1,
        hearing_status_1,
        examination_result_1,
        extension_certainty_2,
        hearing_status_2,
        examination_result_2
      FROM student_extensions
    `);

    const extensionData = extensionResult.rows;

    // メインDBからアクティブ生徒データ取得
    const mainPool = getPool();
    const studentsResult = await mainPool.query(`
      SELECT 
        student_id,
        continued_months,
        homeroom_tutor,
        status,
        contract_plan
      FROM students
      WHERE status = 'アクティブ'
        AND contract_plan NOT IN ('永久会員', '在籍プラン')
    `);

    const students = studentsResult.rows;
    console.log('  アクティブ生徒数:', students.length);

    // 延長審査データマップ作成
    const extensionMap = {};
    extensionData.forEach(ext => {
      extensionMap[ext.student_id] = ext;
    });

    // Tutor別集計
    const tutorStats = {};

    students.forEach(student => {
      const tutor = student.homeroom_tutor;
      if (!tutor) return;

      if (!tutorStats[tutor]) {
        tutorStats[tutor] = {
          tutorName: tutor,
          hearingTargetCount: 0, // ヒアリング対象数（4,10ヶ月目）
          examTargetCount: 0, // 延長審査対象数（5,11ヶ月目）
          hearingIncompleteCount: 0, // ヒアリング未完了数
          examIncompleteCount: 0 // 審査未完了数
        };
      }

      const months = student.continued_months;
      const ext = extensionMap[student.student_id];

      // ヒアリング対象：4ヶ月目、10ヶ月目
      if (months === 4 || months === 10) {
        const cycle = months === 4 ? 1 : 2;
        const hearingStatus = cycle === 1 ? ext?.hearing_status_1 : ext?.hearing_status_2;

        tutorStats[tutor].hearingTargetCount++;

        // ヒアリング未完了：hearing_statusがfalseまたはnull
        if (!hearingStatus) {
          tutorStats[tutor].hearingIncompleteCount++;
        }
      }

      // 延長審査対象：5ヶ月目、11ヶ月目
      if (months === 5 || months === 11) {
        const cycle = months === 5 ? 1 : 2;
        const examResult = cycle === 1 ? ext?.examination_result_1 : ext?.examination_result_2;

        tutorStats[tutor].examTargetCount++;

        // 審査未完了：examination_resultがnull
        if (!examResult) {
          tutorStats[tutor].examIncompleteCount++;
        }
      }
    });

    // 配列に変換してソート（ヒアリング対象数の降順）
    const tutorList = Object.values(tutorStats).sort((a, b) => 
      b.hearingTargetCount - a.hearingTargetCount
    );

    console.log('  ✅ Tutor stats calculated:', tutorList.length, 'tutors');

    return c.json({
      success: true,
      data: tutorList
    });

  } catch (error) {
    console.error('❌ Error fetching extension data by tutor:', error);
    console.error('Error stack:', error.stack);
    return c.json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, 500);
  }
});

/**
 * GET /api/extensions/by-team
 * チーム別の延長管理統計を取得
 */
app.get('/by-team', async (c) => {
  try {
    console.log('👥 Fetching extension data by team...');

    // Check if extension DB is configured
    const pool = getExtensionPool();
    if (!pool) {
      console.warn('⚠️ Extension database not configured (EXTENSION_DATABASE_URL missing)');
      return c.json({
        success: false,
        error: 'Extension database not configured. Please set EXTENSION_DATABASE_URL environment variable.'
      }, 503);
    }

    // 延長審査DBから全データ取得
    const extensionResult = await queryExtension(`
      SELECT 
        student_id,
        extension_certainty_1,
        examination_result_1,
        extension_certainty_2,
        examination_result_2
      FROM student_extensions
    `);

    const extensionData = extensionResult.rows;

    // メインDBからアクティブ生徒データとTutor情報を取得
    const mainPool = getPool();
    const studentsResult = await mainPool.query(`
      SELECT 
        s.student_id,
        s.continued_months,
        s.homeroom_tutor,
        s.status,
        s.contract_plan,
        t.team
      FROM students s
      LEFT JOIN tutors t ON s.homeroom_tutor = t.notion_name
      WHERE s.status = 'アクティブ'
        AND s.contract_plan NOT IN ('永久会員', '在籍プラン')
    `);

    const students = studentsResult.rows;
    console.log('  アクティブ生徒数:', students.length);

    // 延長審査データマップ作成
    const extensionMap = {};
    extensionData.forEach(ext => {
      extensionMap[ext.student_id] = ext;
    });

    // チーム別集計
    const teamStats = {};

    students.forEach(student => {
      const team = student.team || '未所属';
      const months = student.continued_months;
      const ext = extensionMap[student.student_id];

      if (!teamStats[team]) {
        teamStats[team] = {
          teamName: team,
          targetCount: 0,          // 延長対象数（5,11ヶ月目）
          extensionCount: 0,       // 延長数
          withdrawalCount: 0,      // 退会数
          extensionRate: 0,        // 延長率
          exam1stTargetCount: 0,   // 1回目対象数
          exam1stExtensionCount: 0,// 1回目延長数
          exam1stExtensionRate: 0, // 1回目延長率
          exam2ndTargetCount: 0,   // 2回目対象数
          exam2ndExtensionCount: 0,// 2回目延長数
          exam2ndExtensionRate: 0  // 2回目延長率
        };
      }

      // サイクル判定
      const cycle = (months === 4 || months === 5) ? 1 : 2;
      const examResult = cycle === 1 ? ext?.examination_result_1 : ext?.examination_result_2;

      // 延長対象数：5ヶ月目と11ヶ月目のみカウント
      if (months === 5 || months === 11) {
        teamStats[team].targetCount++;

        if (examResult === '延長') {
          teamStats[team].extensionCount++;
        } else if (examResult === '退会') {
          teamStats[team].withdrawalCount++;
        }

        // 1回目・2回目の統計
        if (months === 5) {
          teamStats[team].exam1stTargetCount++;
          if (examResult === '延長') {
            teamStats[team].exam1stExtensionCount++;
          }
        } else if (months === 11) {
          teamStats[team].exam2ndTargetCount++;
          if (examResult === '延長') {
            teamStats[team].exam2ndExtensionCount++;
          }
        }
      }
    });

    // 延長率を計算
    Object.values(teamStats).forEach(team => {
      team.extensionRate = team.targetCount > 0 
        ? Math.round((team.extensionCount / team.targetCount) * 100 * 10) / 10 
        : 0;
      
      team.exam1stExtensionRate = team.exam1stTargetCount > 0
        ? Math.round((team.exam1stExtensionCount / team.exam1stTargetCount) * 100 * 10) / 10
        : 0;
      
      team.exam2ndExtensionRate = team.exam2ndTargetCount > 0
        ? Math.round((team.exam2ndExtensionCount / team.exam2ndTargetCount) * 100 * 10) / 10
        : 0;
    });

    // 配列に変換してソート（延長対象数の降順）
    const teamList = Object.values(teamStats).sort((a, b) => 
      b.targetCount - a.targetCount
    );

    console.log('  ✅ Team stats calculated:', teamList.length, 'teams');

    return c.json({
      success: true,
      data: teamList
    });

  } catch (error) {
    console.error('❌ Error fetching extension data by team:', error);
    console.error('Error stack:', error.stack);
    return c.json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, 500);
  }
});

export default app;
