// API Base URL
const API_BASE = '';

// Authentication state
let currentUser = null; // { id, email, role, tutorName, mustChangePassword }
let sessionToken = localStorage.getItem('sessionToken') || null;

// State
let students = [];
let tutors = [];
let satisfactionData = {}; // tutor_name -> { yearMonth -> { average, count, reasons } }
let tutorMonthlyStats = { byEmployeeId: {}, rescheduleByName: {} }; // Monthly helper/reschedule counts
let lessonStats = {};
let lessonDates = {}; // student_id -> [dates]
let lessonReportStatus = {}; // { student_id-lesson_date: report_data }
let cachedNotionUrls = {}; // student_id -> notion_url
let currentMonth = new Date();
let selectedTutor = 'all';
let reservationCountFilter = 'all'; // 'all', 'above2', 'below2'
let selectedTeam = 'all'; // チームフィルター用
let selectedTutorYear = new Date().getFullYear(); // Tutor満足度表示年
let selectedTutorMonth = new Date().getMonth() + 1; // Tutor満足度表示月
let currentTab = 'active'; // 'active', 'preparing', 'suspended', 'graduated', 'cancelled', 'today'
let activeSubTab = 'lesson'; // 'lesson', 'pro', 'permanent', 'enrolled' (for active tab only)
let currentPage = 'today'; // 'reservations', 'students', 'tutors', 'today', 'helpers', 'schedules', 'users', 'extensions', 'lesson-reports'
let schedules = []; // Tutor schedules data
let pendingRequests = []; // Pending absence requests

// Current authenticated tutor (for absence requests) - kept for backward compatibility
let currentTutorEmail = null;
let currentTutorName = null;

// Extension management data
let extensionTutorStats = [];
let selectedExtensionTutor = null; // For badge display

// Schedule filters
let selectedScheduleYear = new Date().getFullYear();
let selectedScheduleMonth = new Date().getMonth() + 1; // 1-12
let selectedKeyword = 'all'; // all, ロープレ, 1on1, チームMTG, チーム研修, 全Tutor MTG
let selectedDateRange = 'all'; // all, this_week, next_week, this_month, next_month
let selectedLeader = 'all'; // all or tutor_name
let selectedAttendee = 'all'; // all or tutor_name
let scheduleViewMode = 'list'; // list or calendar
let scheduleTab = 'confirmed'; // confirmed (受理済み) or pending (申請中)

// Column filters and sort state for student management page
let columnFilters = {}; // { columnName: selectedValue }
let sortColumn = null; // Current sort column name
let sortDirection = 'asc'; // 'asc' or 'desc'

// Debug flag for lesson reports (can be toggled in console)
window.debugLessonReport = false;

// Helper function to format YouTube URL
function formatYouTubeUrl(youtubeId) {
  if (!youtubeId) return null;
  
  // Remove whitespace
  youtubeId = youtubeId.trim();
  
  // If already a full URL, return as-is
  if (youtubeId.startsWith('http://') || youtubeId.startsWith('https://')) {
    return youtubeId;
  }
  
  // If starts with @, use handle format
  if (youtubeId.startsWith('@')) {
    return `https://www.youtube.com/${youtubeId}`;
  }
  
  // If starts with UC (channel ID), use channel format
  if (youtubeId.startsWith('UC')) {
    return `https://www.youtube.com/channel/${youtubeId}`;
  }
  
  // Otherwise, assume it's a handle without @
  return `https://www.youtube.com/@${youtubeId}`;
}

// Helper function to format X (Twitter) URL
function formatXUrl(xId) {
  if (!xId) return null;
  
  // Remove whitespace
  xId = xId.trim();
  
  // If already a full URL, return as-is
  if (xId.startsWith('http://') || xId.startsWith('https://')) {
    return xId;
  }
  
  // Remove @ if present
  if (xId.startsWith('@')) {
    xId = xId.substring(1);
  }
  
  // Return formatted URL
  return `https://x.com/${xId}`;
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  // Verify session
  const isAuthenticated = await verifySession();
  
  if (!isAuthenticated) {
    showLoginPage();
    return;
  }
  
  // Check URL hash for direct navigation
  const hash = window.location.hash.substring(1); // Remove '#'
  if (hash === 'helpers') {
    currentPage = 'helpers';
  } else if (hash === 'students') {
    currentPage = 'students';
  } else if (hash === 'reservations') {
    currentPage = 'reservations';
  } else if (hash === 'tutors') {
    currentPage = 'tutors';
  } else if (hash === 'schedules') {
    currentPage = 'schedules';
  } else if (hash === 'users') {
    currentPage = 'users';
  } else if (hash === 'extensions') {
    currentPage = 'extensions';
  } else if (hash === 'database') {
    currentPage = 'database';
  }
  // Default is 'today' (already set)
  
  renderHeader();
  await loadInitialData();
  await renderApp();
});

// Render header
function renderHeader() {
  const app = document.getElementById('app');
  
  // Debug: Log current user info
  console.log('renderHeader - currentUser:', currentUser);
  console.log('renderHeader - currentUser.role:', currentUser?.role);
  
  // Build user management button (admin only)
  const userManagementButton = currentUser && currentUser.role === 'admin' ? `
    <button id="nav-users" onclick="changePage('users')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'users' ? 'bg-white text-orange-600' : 'bg-orange-600 text-white hover:bg-orange-700'}">
      <i class="fas fa-users-cog mr-2"></i>ユーザー管理
    </button>
  ` : '';
  
  // Build database management button (admin only)
  const databaseManagementButton = currentUser && currentUser.role === 'admin' ? `
    <button id="nav-database" onclick="changePage('database')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'database' ? 'bg-white text-orange-600' : 'bg-orange-600 text-white hover:bg-orange-700'}">
      <i class="fas fa-database mr-2"></i>DB管理
    </button>
  ` : '';
  
  // Build VQ diagnosis button (leader or above)
  const vqDiagnosisButton = currentUser && (currentUser.role === 'admin' || currentUser.role === 'leader') ? `
    <button id="nav-vq-diagnosis" onclick="changePage('vq-diagnosis')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'vq-diagnosis' ? 'bg-white text-orange-600' : 'bg-orange-600 text-white hover:bg-orange-700'}">
      <i class="fas fa-clipboard-check mr-2"></i>VQ診断
    </button>
  ` : '';
  
  // Build lesson reports button (leader or above)
  const lessonReportsButton = currentUser && (currentUser.role === 'admin' || currentUser.role === 'leader') ? `
    <button id="nav-lesson-reports" onclick="changePage('lesson-reports')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'lesson-reports' ? 'bg-white text-orange-600' : 'bg-orange-600 text-white hover:bg-orange-700'}">
      <i class="fas fa-clipboard-list mr-2"></i>レッスン報告
    </button>
  ` : '';
  
  // Build roulette winners button (leader or above)
  const rouletteWinnersButton = currentUser && (currentUser.role === 'admin' || currentUser.role === 'leader') ? `
    <button id="nav-roulette-winners" onclick="changePage('roulette-winners')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'roulette-winners' ? 'bg-white text-orange-600' : 'bg-orange-600 text-white hover:bg-orange-700'}">
      <i class="fas fa-trophy mr-2"></i>特典送付済み
    </button>
  ` : '';
  
  console.log('renderHeader - userManagementButton:', userManagementButton ? 'yes' : 'no');
  console.log('renderHeader - databaseManagementButton:', databaseManagementButton ? 'yes' : 'no');
  
  app.innerHTML = `
    <div class="min-h-screen bg-gray-50">
      <!-- Header -->
      <header class="bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-lg">
        <div class="container mx-auto px-4 py-6">
          <div class="flex justify-between items-start">
            <div>
              <h1 class="text-3xl font-bold">
                <i class="fas fa-users mr-3"></i>
                WannaV 中央管理システム
              </h1>
            </div>
            
            <!-- User info and logout -->
            <div class="flex items-center gap-4">
              ${currentUser.role === 'admin' || currentUser.role === 'leader' ? `
                <!-- Survey Notification Toggle (Leader+) -->
                <div class="flex items-center gap-2 px-3 py-2 bg-blue-700 rounded-lg">
                  <span class="text-sm text-white">特典通知:</span>
                  <button 
                    id="survey-notification-toggle" 
                    onclick="toggleSurveyNotification()" 
                    class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-600"
                  >
                    <span class="sr-only">特典通知の切り替え</span>
                    <span id="survey-toggle-indicator" class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"></span>
                  </button>
                  <span id="survey-toggle-label" class="text-xs font-semibold text-white">OFF</span>
                </div>
              ` : ''}
              <div class="text-right">
                <div class="text-sm text-blue-100">ログイン中</div>
                <div class="font-semibold">${currentUser.tutorName || currentUser.email}</div>
                <div class="text-xs text-blue-200">${getRoleLabel(currentUser.role)}</div>
              </div>
              <button onclick="logout()" class="px-4 py-2 bg-blue-700 hover:bg-blue-800 rounded-lg transition">
                <i class="fas fa-sign-out-alt mr-2"></i>ログアウト
              </button>
            </div>
          </div>
          
          <!-- Navigation - Organized by sections -->
          <nav class="mt-6 flex gap-4 flex-wrap">
            <!-- Lesson Section (Green) -->
            <div class="flex gap-2">
              <button id="nav-today" onclick="changePage('today')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'today' ? 'bg-white text-green-600' : 'bg-green-600 text-white hover:bg-green-700'}">
                <i class="fas fa-calendar-day mr-2"></i>今日のレッスン
              </button>
              <button id="nav-reservations" onclick="changePage('reservations')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'reservations' ? 'bg-white text-green-600' : 'bg-green-600 text-white hover:bg-green-700'}">
                <i class="fas fa-calendar-check mr-2"></i>予約管理
              </button>
              <button id="nav-helpers" onclick="changePage('helpers')" class="relative px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'helpers' ? 'bg-white text-green-600' : 'bg-green-600 text-white hover:bg-green-700'}">
                <i class="fas fa-hands-helping mr-2"></i>助っ人待ち
                <span id="helper-badge" class="hidden absolute -top-1 -left-1 bg-red-600 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center"></span>
              </button>
            </div>
            
            <!-- Divider -->
            <div class="w-px bg-white/30"></div>
            
            <!-- Student Section (Blue) -->
            <div class="flex gap-2">
              <button id="nav-students" onclick="changePage('students')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'students' ? 'bg-white text-blue-600' : 'bg-blue-600 text-white hover:bg-blue-700'}">
                <i class="fas fa-user-graduate mr-2"></i>生徒管理
              </button>
              <button id="nav-red-list" onclick="changePage('red-list')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'red-list' ? 'bg-white text-blue-600' : 'bg-blue-600 text-white hover:bg-blue-700'}">
                <i class="fas fa-exclamation-triangle mr-2"></i>レッドリスト
              </button>
              <button id="nav-extensions" onclick="changePage('extensions')" class="relative px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'extensions' ? 'bg-white text-blue-600' : 'bg-blue-600 text-white hover:bg-blue-700'}">
                <i class="fas fa-sync-alt mr-2"></i>延長管理
                <span id="extension-hearing-badge" class="hidden absolute -top-1 -left-1 bg-orange-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center"></span>
                <span id="extension-exam-badge" class="hidden absolute -top-1 left-8 bg-red-600 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center"></span>
              </button>
              <button id="nav-suspensions" onclick="changePage('suspensions')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'suspensions' ? 'bg-white text-blue-600' : 'bg-blue-600 text-white hover:bg-blue-700'}">
                <i class="fas fa-pause-circle mr-2"></i>休会管理
              </button>
              <button id="nav-broadcast" onclick="changePage('broadcast')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'broadcast' ? 'bg-white text-blue-600' : 'bg-blue-600 text-white hover:bg-blue-700'}">
                <i class="fas fa-bullhorn mr-2"></i>一斉送信
              </button>
            </div>
            
            <!-- Divider -->
            <div class="w-px bg-white/30"></div>
            
            <!-- Tutor Section (Purple) -->
            <div class="flex gap-2">
              <button id="nav-tutors" onclick="changePage('tutors')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'tutors' ? 'bg-white text-purple-600' : 'bg-purple-600 text-white hover:bg-purple-700'}">
                <i class="fas fa-chalkboard-teacher mr-2"></i>Tutor管理
              </button>
              <button id="nav-schedules" onclick="changePage('schedules')" class="px-4 py-2 rounded-lg font-semibold transition ${currentPage === 'schedules' ? 'bg-white text-purple-600' : 'bg-purple-600 text-white hover:bg-purple-700'}">
                <i class="fas fa-calendar-alt mr-2"></i>スケジュール
              </button>
            </div>
            
            ${userManagementButton || databaseManagementButton || vqDiagnosisButton || lessonReportsButton || rouletteWinnersButton ? `
              <!-- Divider -->
              <div class="w-px bg-white/30"></div>
              
              <!-- Admin Section (Orange) -->
              <div class="flex gap-2">
                ${vqDiagnosisButton}
                ${lessonReportsButton}
                ${rouletteWinnersButton}
                ${userManagementButton}
                ${databaseManagementButton}
              </div>
            ` : ''}
          </nav>
        </div>
      </header>

      <!-- Main Content -->
      <main class="container mx-auto px-4 py-8">
        <div id="loading" class="text-center py-12">
          <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
          <p class="mt-4 text-gray-600">データを読み込んでいます...</p>
        </div>
        <div id="content" class="hidden"></div>
      </main>
    </div>
  `;
  
  // Update toggle UI after header is rendered
  // Wait for next tick to ensure DOM is ready
  setTimeout(() => {
    updateSurveyToggleUI();
  }, 0);
}

/**
 * Get role label in Japanese
 */
function getRoleLabel(role) {
  switch(role) {
    case 'admin': return '管理者';
    case 'leader': return 'リーダー';
    case 'crew': return 'クルー';
    default: return role;
  }
}

// Load initial data
async function loadInitialData() {
  try {
    // Sync data from Notion
    try {
      await axios.get(`${API_BASE}/api/students/sync`);
    } catch (syncError) {
      console.error('Error syncing students:', syncError);
      if (syncError.response && syncError.response.data) {
        const errorData = syncError.response.data;
        if (errorData.error && errorData.error.includes('Cache spreadsheet is empty')) {
          alert('⚠️ キャッシュシートが空です\n\nNotionからのデータ同期が必要です。\nキャッシュ更新スクリプトを実行してください。');
          throw syncError;
        }
      }
      throw syncError;
    }
    
    const tutorSyncRes = await axios.get(`${API_BASE}/api/tutors/sync`);
    console.log('Tutor sync result:', tutorSyncRes.data);
    if (tutorSyncRes.data.deleted > 0) {
      console.log(`⚠️ ${tutorSyncRes.data.deleted}人のTutorがスプレッドシートから削除されたためDBからも削除されました`);
    }
    
    // Sync lessons from Google Sheets (populated by GAS)
    console.log('Syncing lessons from Google Sheets...');
    const sheetSyncRes = await axios.get(`${API_BASE}/api/lessons/sync-from-sheet`);
    console.log('Sheet sync result:', sheetSyncRes.data);
    
    // Load data
    const [studentsRes, tutorsRes] = await Promise.all([
      axios.get(`${API_BASE}/api/students`),
      axios.get(`${API_BASE}/api/tutors`)
    ]);
    
    students = studentsRes.data.data;
    tutors = tutorsRes.data.data;
    
    // Cache Notion URLs for students
    students.forEach(student => {
      if (student.notion_url) {
        cachedNotionUrls[student.student_id] = student.notion_url;
      }
    });
    
    console.log(`Cached ${Object.keys(cachedNotionUrls).length} Notion URLs`);
    
    // Load satisfaction data
    await loadSatisfactionData();
    
    // Load monthly tutor stats (helper requests, accepted, reschedule counts)
    await loadTutorMonthlyStats();
    
    // Load lesson stats and dates for current month
    await loadLessonStats();
    await loadLessonDates();
    
    // Load helper requests for badge count
    await loadHelperRequests();
    
    // Load extension tutor stats for badge count
    await loadExtensionTutorStats();
    
    // Load survey stats for all students
    await loadSurveyStats();
    
    // Load survey notification setting
    await loadSurveyNotificationSetting();
    
    // Set default filter to current tutor if available
    if (currentTutorName) {
      // Convert tutor_name to notion_name for filtering
      const notionName = getTutorNotionName(currentTutorName);
      if (notionName) {
        selectedTutor = notionName;          // Use Notion name for student filtering
        selectedLeader = currentTutorName;   // Use tutor_name for schedule leader filtering
        selectedAttendee = currentTutorName; // Use tutor_name for schedule attendee filtering
        console.log(`Default filter set - Tutor: ${currentTutorName}, Notion: ${notionName}`);
      } else {
        console.warn(`Could not find Notion name for tutor: ${currentTutorName}`);
      }
    }
  } catch (error) {
    console.error('Error loading initial data:', error);
    alert('データの読み込みに失敗しました: ' + error.message);
  }
}

// Load lesson statistics
async function loadLessonStats() {
  try {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth() + 1;
    
    const res = await axios.get(`${API_BASE}/api/lessons/stats/${year}/${month}`);
    
    // Convert array to object for easy lookup
    lessonStats = {};
    res.data.data.forEach(stat => {
      lessonStats[stat.student_id] = parseInt(stat.lesson_count);
    });
  } catch (error) {
    console.error('Error loading lesson stats:', error);
  }
}

// Load satisfaction data
async function loadSatisfactionData() {
  try {
    const res = await axios.get(`${API_BASE}/api/tutors/satisfaction/all`);
    satisfactionData = res.data.data || {};
    console.log('Loaded satisfaction data:', Object.keys(satisfactionData).length, 'tutors');
  } catch (error) {
    console.error('Error loading satisfaction data:', error);
    satisfactionData = {};
  }
}

// Load monthly tutor stats (helper requests, accepted, reschedule counts)
async function loadTutorMonthlyStats() {
  try {
    const res = await axios.get(`${API_BASE}/api/tutors/monthly-stats/${selectedTutorYear}/${selectedTutorMonth}`);
    if (res.data.success) {
      tutorMonthlyStats = res.data.data || { byEmployeeId: {}, rescheduleByName: {} };
      console.log(`[Tutor Stats] Loaded monthly stats for ${selectedTutorYear}/${selectedTutorMonth}`);
    }
  } catch (error) {
    console.error('Error loading tutor monthly stats:', error);
    tutorMonthlyStats = { byEmployeeId: {}, rescheduleByName: {} };
  }
}

// Load lesson dates for current month
async function loadLessonDates() {
  try {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth() + 1;
    
    console.log(`Loading lesson dates for: ${year}/${month}`);
    
    const res = await axios.get(`${API_BASE}/api/lessons/month/${year}/${month}`);
    
    // Group dates by student_id
    lessonDates = {};
    res.data.data.forEach(lesson => {
      if (!lessonDates[lesson.student_id]) {
        lessonDates[lesson.student_id] = [];
      }
      
      // Parse UTC date from database
      const utcDate = new Date(lesson.lesson_date);
      
      // Format as JST date string (YYYY/MM/DD)
      // Note: Database stores JST times as UTC, so we need to extract the date part
      const dateStr = lesson.lesson_date.split('T')[0]; // "2026-02-26"
      const [yearStr, monthStr, dayStr] = dateStr.split('-');
      
      lessonDates[lesson.student_id].push({
        date: utcDate,
        formatted: `${parseInt(monthStr)}/${parseInt(dayStr)}`
      });
      
      if (lesson.student_id === 'OLTS240499-HK') {
        console.log(`Student ${lesson.student_id}: DB=${lesson.lesson_date}, formatted=${parseInt(monthStr)}/${parseInt(dayStr)}`);
      }
    });
    
    // Sort dates
    Object.keys(lessonDates).forEach(studentId => {
      lessonDates[studentId].sort((a, b) => a.date - b.date);
    });
    
    console.log(`Loaded lesson dates for ${Object.keys(lessonDates).length} students`);
  } catch (error) {
    console.error('Error loading lesson dates:', error);
  }
}

// Load lesson dates for today (always loads current month)
async function loadTodayLessonDates() {
  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    
    const res = await axios.get(`${API_BASE}/api/lessons/month/${year}/${month}`);
    
    // Group dates by student_id
    lessonDates = {};
    res.data.data.forEach(lesson => {
      if (!lessonDates[lesson.student_id]) {
        lessonDates[lesson.student_id] = [];
      }
      
      // Parse UTC date from database
      const utcDate = new Date(lesson.lesson_date);
      
      // Format as JST date string (YYYY/MM/DD)
      // Note: Database stores JST times as UTC, so we need to extract the date part
      const dateStr = lesson.lesson_date.split('T')[0]; // "2026-02-26"
      const [yearStr, monthStr, dayStr] = dateStr.split('-');
      
      // Extract time from lesson_date (stored as JST in UTC format) or use lesson_time from sheet
      let timeStr;
      if (lesson.lesson_time) {
        // Use time from spreadsheet (J column)
        timeStr = lesson.lesson_time;
      } else {
        // Fallback: extract from lesson_date
        const timePart = lesson.lesson_date.split('T')[1]?.split('.')[0] || '00:00:00';
        const [hourStr, minuteStr] = timePart.split(':');
        const hour = parseInt(hourStr);
        const minute = parseInt(minuteStr);
        timeStr = `${hour}:${minute.toString().padStart(2, '0')}`;
      }
      
      lessonDates[lesson.student_id].push({
        date: utcDate,
        formatted: `${parseInt(monthStr)}/${parseInt(dayStr)}`,
        time: timeStr,
        meet_link: lesson.meet_link || null
      });
    });
    
    // Sort dates
    Object.keys(lessonDates).forEach(studentId => {
      lessonDates[studentId].sort((a, b) => a.date - b.date);
    });
    
    console.log(`Loaded ${Object.keys(lessonDates).length} students' lesson dates for today's page`);
  } catch (error) {
    console.error('Error loading today lesson dates:', error);
  }
}

// Count how many lessons this student has in current month
function countLessonsThisMonth(studentId, currentDate) {
  const student = students.find(s => s.student_id === studentId);
  if (!student || !student.lesson_dates) return 0;
  
  const currentYear = new Date(currentDate).getFullYear();
  const currentMonth = new Date(currentDate).getMonth();
  
  let count = 0;
  student.lesson_dates.forEach(dateStr => {
    const lessonDate = new Date(dateStr);
    if (lessonDate.getFullYear() === currentYear && 
        lessonDate.getMonth() === currentMonth &&
        lessonDate <= new Date(currentDate)) {
      count++;
    }
  });
  
  return count;
}

// Load lesson report status for a specific date
async function loadLessonReportStatus(date) {
  try {
    console.log(`📋 Loading lesson reports for date: ${date}`);
    const url = `${API_BASE}/api/lesson-reports/by-date/${date}`;
    console.log(`📋 Request URL: ${url}`);
    
    const response = await axios.get(url);
    
    console.log(`📋 Response status: ${response.status}`);
    console.log(`📋 Response data:`, response.data);
    
    if (response.data.success) {
      // Store reports by student_id-date key
      lessonReportStatus = {};
      response.data.data.forEach(report => {
        // Extract date part only (YYYY-MM-DD) from ISO timestamp
        const dateOnly = report.lesson_date.split('T')[0];
        const key = `${report.student_id}-${dateOnly}`;
        lessonReportStatus[key] = report;
        console.log(`📝 Stored report: key="${key}", result="${report.lesson_result}"`);
      });
      console.log(`✅ Loaded ${response.data.count} lesson reports for ${date}`);
      console.log(`✅ Report keys:`, Object.keys(lessonReportStatus));
      console.log(`✅ Full lessonReportStatus:`, lessonReportStatus);
    }
  } catch (error) {
    console.error('❌ Error loading lesson report status:');
    console.error('Error message:', error.message);
    console.error('Error response status:', error.response?.status);
    console.error('Error response data:', error.response?.data);
    
    // 404 or other errors - initialize empty status (all buttons will show as "未提出")
    lessonReportStatus = {};
    
    // If it's a 404, the table probably doesn't exist yet
    if (error.response?.status === 404) {
      console.warn('⚠️ レッスン報告テーブルがまだ作成されていない可能性があります');
      console.warn('⚠️ マイグレーションを実行してください: npm run db:migrate');
    }
  }
}

// Render main app
async function renderApp() {
  // Check if elements exist
  const loadingElement = document.getElementById('loading');
  const contentElement = document.getElementById('content');
  
  if (loadingElement) {
    loadingElement.classList.add('hidden');
  }
  if (contentElement) {
    contentElement.classList.remove('hidden');
  }
  
  // Render based on current page
  if (currentPage === 'reservations') {
    renderReservationsPage();
  } else if (currentPage === 'students') {
    renderStudentsPage();
  } else if (currentPage === 'red-list') {
    await renderRedListPage();
  } else if (currentPage === 'tutors') {
    renderTutorsPage();
  } else if (currentPage === 'today') {
    await renderTodayLessonsPage();
  } else if (currentPage === 'helpers') {
    await renderHelpersPage();
  } else if (currentPage === 'schedules') {
    await renderSchedulesPage();
  } else if (currentPage === 'users') {
    await renderUsersPage();
  } else if (currentPage === 'extensions') {
    await renderExtensionsPage();
  } else if (currentPage === 'suspensions') {
    await renderSuspensionsPage();
  } else if (currentPage === 'broadcast') {
    await renderBroadcastPage();
  } else if (currentPage === 'database') {
    await renderDatabasePage();
  } else if (currentPage === 'vq-diagnosis') {
    await renderVQDiagnosisPage();
  } else if (currentPage === 'lesson-reports') {
    await renderLessonReportsPage();
  } else if (currentPage === 'roulette-winners') {
    await renderRouletteWinnersPage();
  } else {
    // Default to today's lessons
    currentPage = 'today';
    await renderTodayLessonsPage();
  }
}

// Change page
async function changePage(page) {
  currentPage = page;
  renderHeader();
  
  // Update all badges after header render
  updateHelperBadge();
  updateExtensionBadges();
  
  await renderApp();
}

// Render Reservations Page (original page with all columns)
function renderReservationsPage() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  
  const content = document.getElementById('content');
  
  content.innerHTML = `
    <!-- Controls -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- Month Navigation -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-calendar-alt mr-2"></i>
            月選択
          </label>
          <div class="flex items-center gap-2">
            <button onclick="changeMonth(-1)" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              <i class="fas fa-chevron-left mr-2"></i>先月
            </button>
            <span class="px-4 py-2 bg-gray-100 rounded-lg font-semibold text-center flex-1" id="current-month-display">
              ${formatMonth(currentMonth)}
            </span>
            <button onclick="changeMonth(1)" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              来月<i class="fas fa-chevron-right ml-2"></i>
            </button>
          </div>
        </div>

        <!-- Tutor Filter -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-filter mr-2"></i>
            担当Tutor絞り込み
          </label>
          <select id="tutor-filter-reservations" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
            <option value="all" ${selectedTutor === 'all' ? 'selected' : ''}>すべてのTutor</option>
            ${getTutorOptions()}
          </select>
        </div>

        <!-- Reservation Count Filter -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-calendar-check mr-2"></i>
            予約回数絞り込み
          </label>
          <select id="reservation-count-filter" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
            <option value="all">すべて</option>
            <option value="above2">2回以上</option>
            <option value="below2">2回未満</option>
          </select>
        </div>
      </div>

      <!-- Actions -->
      <div class="mt-4 flex gap-2 flex-wrap">
        <button onclick="refreshData()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
          <i class="fas fa-sync-alt mr-2"></i>データ更新
        </button>
        <button onclick="resetTestRouletteResults()" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">
          <i class="fas fa-undo mr-2"></i>テスト抽選リセット
        </button>
        <button onclick="sendReminders()" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">
          <i class="fas fa-bell mr-2"></i>リマインド送信
        </button>
        <button onclick="openHelperRequestModal()" class="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition">
          <i class="fas fa-hand-paper mr-2"></i>助っ人Tutor依頼
        </button>
      </div>
    </div>

    <!-- Statistics (only Active students with レッスン中 or PROプラン) -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-chart-bar mr-2"></i>
        統計情報 <span class="text-sm text-gray-500">(アクティブ・レッスン中/PROプランのみ)</span>
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        ${renderStatistics()}
      </div>
    </div>

    <!-- Status Tabs -->
    <div class="bg-white rounded-lg shadow-md p-2 mb-6">
      <div class="flex flex-wrap gap-2">
        <button onclick="switchTab('active')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'active' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-check-circle mr-2"></i>アクティブ
        </button>
        <button onclick="switchTab('preparing')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'preparing' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-clock mr-2"></i>レッスン準備中
        </button>
        <button onclick="switchTab('suspended')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'suspended' ? 'bg-yellow-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-pause-circle mr-2"></i>休会
        </button>
        <button onclick="switchTab('graduated')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'graduated' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-user-graduate mr-2"></i>正規退会
        </button>
        <button onclick="switchTab('cancelled')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'cancelled' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-user-times mr-2"></i>無断キャンセル
        </button>
      </div>
      ${renderActiveSubTabs()}
    </div>

    <!-- Student List -->
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-list mr-2"></i>
        ${getTabTitle()}
      </h2>
      ${renderContractPlanTabs()}
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">学籍番号</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">生徒名</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ステータス</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">契約プラン</th>
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="max-width: 100px;">キャラ名</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">担任Tutor</th>
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン進捗</th>
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">お支払い</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">今月の予約</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン日</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン実施</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リンク</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${renderStudentRows()}
          </tbody>
        </table>
      </div>
    </div>
  `;
  
  // Set tutor filter and add event listener
  const tutorSelect = document.getElementById('tutor-filter-reservations');
  if (tutorSelect) {
    tutorSelect.value = selectedTutor;
    tutorSelect.addEventListener('change', async (e) => {
      await filterByTutor(e.target.value);
    });
  }
  
  // Set reservation count filter and add event listener
  const reservationCountSelect = document.getElementById('reservation-count-filter');
  if (reservationCountSelect) {
    reservationCountSelect.value = reservationCountFilter;
    reservationCountSelect.addEventListener('change', (e) => {
      reservationCountFilter = e.target.value;
      renderReservationsPage();
    });
  }
  
  // Load roulette markers for filtered students
  const filteredStudents = getFilteredStudents();
  filteredStudents.forEach(async (student) => {
    try {
      const stats = await loadStudentSurveyStats(student.student_id);
      updateRouletteMarker(student.student_id, stats);
    } catch (error) {
      console.error(`Failed to load roulette marker for ${student.student_id}:`, error);
    }
  });
  
  // Load lesson completion status for all students
  loadLessonCompletionBatch();
}

// Get tutor options for filter (only cached tutors)
function getTutorOptions() {
  // Get unique notion_names from students (all tutors, regardless of cache)
  const uniqueNotionNames = [...new Set(
    students
      .map(s => s.homeroom_tutor)
      .filter(notionName => notionName) // 空でないもののみ
  )];
  
  // Map notion_name to tutor_name for display
  return uniqueNotionNames
    .map(notionName => {
      const displayName = getTutorDisplayName(notionName);
      const isSelected = notionName === selectedTutor ? 'selected' : '';
      return `<option value="${notionName}" ${isSelected}>${displayName}</option>`;
    })
    .sort((a, b) => {
      // Sort by display name
      const aText = a.match(/>(.*?)<\/option>/)[1];
      const bText = b.match(/>(.*?)<\/option>/)[1];
      return aText.localeCompare(bText, 'ja');
    })
    .join('');
}

// Render statistics (exclude 正規退会, 無断キャンセル, and 永久会員)
function renderStatistics() {
  // Only count students with status "アクティブ" AND contract plan "レッスン中" (neither PROプラン nor 永久会員 nor 在籍プラン) OR "PROプラン"
  const activeStudents = students.filter(s => 
    s.status === 'アクティブ' && 
    (
      s.contract_plan === 'PROプラン' ||
      (s.contract_plan !== 'PROプラン' && s.contract_plan !== '永久会員' && s.contract_plan !== '在籍プラン')
    )
  );
  
  const filteredStudents = selectedTutor === 'all' 
    ? activeStudents
    : activeStudents.filter(s => s.homeroom_tutor === selectedTutor);
  
  const totalStudents = filteredStudents.length;
  
  const lessonCounts = filteredStudents.map(s => lessonStats[s.student_id] || 0);
  const zeroLessons = lessonCounts.filter(c => c === 0).length;
  const oneLessons = lessonCounts.filter(c => c === 1).length;
  const twoLessons = lessonCounts.filter(c => c === 2).length;
  const threePlusLessons = lessonCounts.filter(c => c >= 3).length;
  
  return `
    <div class="text-center">
      <div class="text-3xl font-bold text-blue-600">${totalStudents}</div>
      <div class="text-sm text-gray-600 mt-1">総生徒数</div>
    </div>
    <div class="text-center">
      <div class="text-3xl font-bold text-red-600">${zeroLessons}</div>
      <div class="text-sm text-gray-600 mt-1">予約0回</div>
    </div>
    <div class="text-center">
      <div class="text-3xl font-bold text-yellow-600">${oneLessons}</div>
      <div class="text-sm text-gray-600 mt-1">予約1回</div>
    </div>
    <div class="text-center">
      <div class="text-3xl font-bold text-cyan-600">${threePlusLessons}</div>
      <div class="text-sm text-gray-600 mt-1">予約3回以上</div>
    </div>
  `;
}

// Render student rows
function renderStudentRows() {
  const filteredStudents = getFilteredStudents();
  
  if (filteredStudents.length === 0) {
    return `
      <tr>
        <td colspan="12" class="px-6 py-4 text-center text-gray-500">
          該当する生徒が見つかりません
        </td>
      </tr>
    `;
  }
  
  return filteredStudents.map(student => {
    const lessonCount = lessonStats[student.student_id] || 0;
    const colorClass = getLessonCountColor(lessonCount);
    const dates = lessonDates[student.student_id] || [];
    const datesStr = dates.length > 0 
      ? dates.map(d => `${d.formatted} ${d.time || ''}`).join(', ')
      : '-';
    
    // Use pre-fetched Notion URL from cache (or generate from page ID as fallback)
    const notionUrl = student.notion_url || 
      (student.notion_page_id ? `https://www.notion.so/${student.notion_page_id.replace(/-/g, '')}` : null);
    
    // Discord URL from Discord destination spreadsheet
    const discordUrl = student.discord_url || null;
    
    // Payment status with color coding
    // Show payment status for the month BEFORE the displayed month
    const viewYear = currentMonth.getFullYear();
    const viewMonth = currentMonth.getMonth() + 1; // JS months are 0-indexed
    
    // Get current real date
    const now = new Date();
    const realYear = now.getFullYear();
    const realMonth = now.getMonth() + 1;
    
    // Parse stored year month info
    let lastYearMonth = student.payment_year_month_last || '';
    let currentYearMonth = student.payment_year_month_current || '';
    
    let paymentStatus = '未払い';
    
    // If viewing current month, show last month's payment
    if (viewYear === realYear && viewMonth === realMonth) {
      paymentStatus = student.payment_status_last_month || '未払い';
    }
    // If viewing next month, show current month's payment
    else if (viewYear === realYear && viewMonth === realMonth + 1) {
      paymentStatus = student.payment_status_current_month || '未払い';
    }
    // For other months, default to last month
    else {
      paymentStatus = student.payment_status_last_month || '未払い';
    }
    
    // Determine payment status color
    let paymentColorClass = '';
    if (paymentStatus === '支払い完了' || paymentStatus === '支払完了') {
      paymentColorClass = 'text-green-600';
    } else if (paymentStatus === '未払い（連絡なし）' || paymentStatus === '未払い') {
      paymentColorClass = 'text-red-600 font-bold';
    } else if (paymentStatus === '未払い（遅れ）') {
      paymentColorClass = 'text-red-600';
    } else {
      paymentColorClass = 'text-gray-900'; // Default color (same as student name)
    }
    
    return `
      <tr class="hover:bg-gray-50 ${colorClass}">
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${student.student_id || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
          <div class="flex items-center gap-2">
            <span>${student.name || '-'}</span>
            <span class="roulette-marker-loading" data-student-id="${student.student_id}"></span>
          </div>
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${student.status || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${student.contract_plan || '-'}</td>
        <td class="px-3 py-3 text-sm text-gray-600" style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${student.character_name || '-'}">${student.character_name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${getTutorDisplayName(student.homeroom_tutor)}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold ${getLessonProgressClass(student.lesson_progress)}">${getLessonProgressDisplay(student.lesson_progress)}</td>
        <td class="px-3 py-3 whitespace-nowrap text-xs text-center ${paymentColorClass}">${paymentStatus}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm font-bold">
          <span class="px-2 py-1 rounded-full text-xs ${getLessonCountBadgeColor(lessonCount)}">
            ${lessonCount}回
          </span>
        </td>
        <td class="px-4 py-3 text-sm text-gray-600" style="max-width: 180px;">
          <div class="overflow-x-auto whitespace-nowrap text-xs">${datesStr}</div>
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center">
          <div class="lesson-completion-loading" data-student-id="${student.student_id}">
            <i class="fas fa-spinner fa-spin text-gray-400"></i>
          </div>
        </td>
        <td class="px-3 py-3 whitespace-nowrap text-center">
          <div class="flex gap-2 justify-center">
            ${notionUrl ? `<a href="${notionUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-blue-600 transition" title="Notionページを開く"><i class="fas fa-file-alt text-lg"></i></a>` : '<span class="text-gray-300"><i class="fas fa-file-alt text-lg"></i></span>'}
            ${discordUrl ? `<a href="${discordUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-indigo-600 transition" title="Discordを開く"><i class="fab fa-discord text-lg"></i></a>` : '<span class="text-gray-300"><i class="fab fa-discord text-lg"></i></span>'}
            ${student.youtube_channel_id ? `<a href="${formatYouTubeUrl(student.youtube_channel_id)}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-red-600 transition" title="YouTubeチャンネルを開く"><i class="fab fa-youtube text-lg"></i></a>` : '<span class="text-gray-300"><i class="fab fa-youtube text-lg"></i></span>'}
            ${student.x_account_id ? `<a href="${formatXUrl(student.x_account_id)}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-black transition" title="X (Twitter)アカウントを開く"><i class="fab fa-twitter text-lg"></i></a>` : '<span class="text-gray-300"><i class="fab fa-twitter text-lg"></i></span>'}
            ${student.student_id ? `<a href="https://vtuber-school-evaluation.onrender.com/evaluation-detail?studentId=${student.student_id}&month=${getPreviousMonth()}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-orange-600 transition" title="リザルトシステムを開く"><i class="fas fa-chart-bar text-lg"></i></a>` : '<span class="text-gray-300"><i class="fas fa-chart-bar text-lg"></i></span>'}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Get filtered students
function getFilteredStudents() {
  // Filter by status tab
  let filtered = students;
  
  if (currentTab === 'active') {
    filtered = students.filter(s => s.status === 'アクティブ');
    
    // Apply sub-tab filter for active tab
    if (activeSubTab === 'lesson') {
      filtered = filtered.filter(s => 
        s.contract_plan !== 'PROプラン' && 
        s.contract_plan !== '永久会員' && 
        s.contract_plan !== '在籍プラン'
      );
    } else if (activeSubTab === 'pro') {
      filtered = filtered.filter(s => s.contract_plan === 'PROプラン');
    } else if (activeSubTab === 'permanent') {
      filtered = filtered.filter(s => s.contract_plan === '永久会員');
    } else if (activeSubTab === 'enrolled') {
      filtered = filtered.filter(s => s.contract_plan === '在籍プラン');
    }
  } else if (currentTab === 'preparing') {
    filtered = students.filter(s => s.status === 'レッスン準備中');
  } else if (currentTab === 'suspended') {
    filtered = students.filter(s => s.status === '休会');
  } else if (currentTab === 'graduated') {
    filtered = students.filter(s => s.status === '正規退会');
  } else if (currentTab === 'cancelled') {
    filtered = students.filter(s => s.status === '無断キャンセル');
  }
  
  // Filter by tutor
  if (selectedTutor !== 'all') {
    filtered = filtered.filter(s => s.homeroom_tutor === selectedTutor);
  }
  
  // Filter by reservation count (only for reservations page)
  if (currentPage === 'reservations' && reservationCountFilter !== 'all') {
    filtered = filtered.filter(s => {
      const lessonCount = lessonStats[s.student_id] || 0;
      if (reservationCountFilter === 'above2') {
        return lessonCount >= 2;
      } else if (reservationCountFilter === 'below2') {
        return lessonCount < 2;
      }
      return true;
    });
  }
  
  // Apply column filters (only on students page)
  if (currentPage === 'students') {
    // Apply survey filter for unreplied students
    if (surveyFilter === 'unreplied') {
      console.log('[Survey Filter] Before filter:', filtered.length, 'students');
      const beforeCount = filtered.length;
      
      filtered = filtered.filter(s => {
        const stats = surveyStatsCache[s.student_id];
        const hasStats = !!stats;
        const notReplied = stats && !stats.respondedThisMonth;
        
        if (!hasStats && s.student_id) {
          console.log('[Survey Filter] Missing stats for:', s.student_id, s.name);
        }
        
        return notReplied;
      });
      
      console.log('[Survey Filter] After filter:', filtered.length, 'students (filtered out', beforeCount - filtered.length, ')');
    }
    
    Object.keys(columnFilters).forEach(column => {
      const filterValue = columnFilters[column];
      if (filterValue && filterValue !== 'all') {
        filtered = filtered.filter(s => {
          let value = s[column];
          
          // Convert homeroom_tutor to display name for comparison
          if (column === 'homeroom_tutor') {
            value = getTutorDisplayName(value);
          }
          
          if (!value) return false;
          
          // Support partial match (case-insensitive)
          const valueStr = value.toString().toLowerCase();
          const filterStr = filterValue.toString().toLowerCase();
          
          return valueStr.includes(filterStr);
        });
      }
    });
    
    // Apply sorting
    if (sortColumn) {
      filtered.sort((a, b) => {
        let aVal = a[sortColumn];
        let bVal = b[sortColumn];
        
        // Handle null/undefined values
        if (aVal === null || aVal === undefined) aVal = '';
        if (bVal === null || bVal === undefined) bVal = '';
        
        // Special handling for numeric fields
        if (['lesson_progress', 'result_absence'].includes(sortColumn)) {
          aVal = parseInt(aVal) || 0;
          bVal = parseInt(bVal) || 0;
        }
        
        // Special handling for date fields
        if (sortColumn === 'lesson_start_date') {
          aVal = aVal ? new Date(aVal) : new Date(0);
          bVal = bVal ? new Date(bVal) : new Date(0);
        }
        
        // Calculate continued_months for sorting
        if (sortColumn === 'continued_months') {
          aVal = calculateContinuedMonths(a.lesson_start_date, a.suspension_months || 0);
          bVal = calculateContinuedMonths(b.lesson_start_date, b.suspension_months || 0);
        }
        
        // Compare
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
  }
  
  return filtered;
}

// Get tutor display name from tutor_name field
function getTutorDisplayName(notionName) {
  if (!notionName) return '-';
  
  // Find matching tutor by notion_name
  const tutor = tutors.find(t => t.notion_name === notionName);
  
  if (tutor && tutor.tutor_name) {
    return tutor.tutor_name;
  }
  
  // Fallback: format notion_name (先生XXX → XXX先生)
  if (notionName.startsWith('先生')) {
    return notionName.substring(2) + '先生';
  }
  
  return notionName;
}

// Get tab title
function getTabTitle() {
  const titles = {
    'active': 'アクティブ生徒一覧',
    'preparing': 'レッスン準備中生徒一覧',
    'suspended': '休会生徒一覧',
    'graduated': '正規退会生徒一覧',
    'cancelled': '無断キャンセル生徒一覧'
  };
  return titles[currentTab] || '生徒一覧';
}

// Render active sub-tabs (for active tab only)
function renderActiveSubTabs() {
  if (currentTab !== 'active') return '';
  
  const activeStudents = students.filter(s => s.status === 'アクティブ');
  const lessonCount = activeStudents.filter(s => 
    s.contract_plan !== '永久会員' && 
    s.contract_plan !== 'PROプラン' && 
    s.contract_plan !== '在籍プラン'
  ).length;
  const proCount = activeStudents.filter(s => s.contract_plan === 'PROプラン').length;
  const permanentCount = activeStudents.filter(s => s.contract_plan === '永久会員').length;
  const enrolledCount = activeStudents.filter(s => s.contract_plan === '在籍プラン').length;
  
  return `
    <div class="mt-3 pt-3 border-t border-gray-200">
      <div class="flex gap-2">
        <button onclick="switchActiveSubTab('lesson')" class="px-4 py-2 rounded-lg font-semibold text-sm transition ${activeSubTab === 'lesson' ? 'bg-green-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}">
          <i class="fas fa-book-open mr-2"></i>レッスン中 (${lessonCount})
        </button>
        <button onclick="switchActiveSubTab('pro')" class="px-4 py-2 rounded-lg font-semibold text-sm transition ${activeSubTab === 'pro' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}">
          <i class="fas fa-star mr-2"></i>PROプラン (${proCount})
        </button>
        <button onclick="switchActiveSubTab('permanent')" class="px-4 py-2 rounded-lg font-semibold text-sm transition ${activeSubTab === 'permanent' ? 'bg-purple-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}">
          <i class="fas fa-crown mr-2"></i>永久会員 (${permanentCount})
        </button>
        <button onclick="switchActiveSubTab('enrolled')" class="px-4 py-2 rounded-lg font-semibold text-sm transition ${activeSubTab === 'enrolled' ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}">
          <i class="fas fa-user-clock mr-2"></i>在籍プラン (${enrolledCount})
        </button>
      </div>
    </div>
  `;
}

// Render contract plan tabs (kept for backward compatibility, now unused)
function renderContractPlanTabs() {
  return '';
}

// Switch tab
function switchTab(tab) {
  currentTab = tab;
  // Reset sub-tab when switching main tabs
  if (tab === 'active') {
    activeSubTab = 'lesson';
  }
  renderApp();
}

// Switch active sub-tab
function switchActiveSubTab(subTab) {
  activeSubTab = subTab;
  renderApp();
}

// Get lesson count color class
function getLessonCountColor(count) {
  if (count === 0) return 'bg-red-50';
  if (count === 1) return 'bg-yellow-50';
  if (count >= 3) return 'bg-cyan-50'; // Changed from bg-yellow-100 to cyan
  return '';
}

// Get lesson count badge color
function getLessonCountBadgeColor(count) {
  if (count === 0) return 'bg-red-200 text-red-800';
  if (count === 1) return 'bg-yellow-200 text-yellow-800';
  if (count >= 3) return 'bg-cyan-200 text-cyan-800'; // Changed from yellow to cyan
  return 'bg-gray-200 text-gray-800';
}

// Get lesson progress display text
function getLessonProgressDisplay(progress) {
  if (!progress) return '-';
  if (progress === 'Proプラン') return 'Proプラン';
  return `レッスン${progress}`;
}

// Get lesson progress CSS class (no color for Pro plan)
function getLessonProgressClass(progress) {
  if (!progress) return 'text-gray-400';
  if (progress === 'Proプラン') return 'text-gray-700';
  return 'text-blue-600';
}

// Get previous month in YYYY-MM format for result system
function getPreviousMonth() {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// Calculate continued months from lesson start date (minus suspension months)
// Start month counts as month 1
function calculateContinuedMonths(startDate, suspensionMonths = 0) {
  if (!startDate) return 0;
  
  try {
    const start = new Date(startDate);
    const now = new Date();
    
    const yearsDiff = now.getFullYear() - start.getFullYear();
    const monthsDiff = now.getMonth() - start.getMonth();
    
    let totalMonths = yearsDiff * 12 + monthsDiff;
    
    // If current day is before start day, subtract one month
    if (now.getDate() < start.getDate()) {
      totalMonths = totalMonths - 1;
    }
    
    // Add 1 to include the start month (start month = month 1)
    totalMonths = totalMonths + 1;
    
    // Subtract suspension months
    totalMonths = totalMonths - suspensionMonths;
    
    return Math.max(0, totalMonths);
  } catch (error) {
    console.error('Error calculating continued months:', error);
    return 0;
  }
}

// Format date to YYYY-MM-DD
function formatDate(dateString) {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (error) {
    return dateString;
  }
}

/**
 * Format date for month input (YYYY-MM)
 */
function formatDateForMonthInput(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  } catch (error) {
    return '';
  }
}

/**
 * Update PRO plan start date for a student
 */
async function updateProPlanStartDate(studentId, monthValue) {
  try {
    if (!monthValue) {
      // User cleared the field
      if (!confirm('PROプラン開始日をクリアしますか？')) {
        // Reload to restore previous value
        await refreshData();
        return;
      }
    }
    
    // Force to 1st of the month
    const date = monthValue ? new Date(monthValue + '-01') : null;
    const proPlanStartDate = date ? date.toISOString().split('T')[0] : null;
    
    const response = await axios.patch(`${API_BASE}/api/students/${studentId}/pro-plan`, {
      proPlanStartDate: proPlanStartDate
    }, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      showAlert('success', 'PROプラン開始日を更新しました');
      // Refresh to show updated continued months
      await refreshData();
    } else {
      showAlert('error', 'PROプラン開始日の更新に失敗しました');
      await refreshData();
    }
  } catch (error) {
    console.error('Error updating PRO plan start date:', error);
    showAlert('error', 'PROプラン開始日の更新中にエラーが発生しました: ' + (error.response?.data?.error || error.message));
    await refreshData();
  }
}

// Format month
function formatMonth(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return `${year}年 ${month}月`;
}

// Change month
async function changeMonth(delta) {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
  
  // Update display
  document.getElementById('current-month-display').textContent = formatMonth(currentMonth);
  
  // Reload lesson stats and dates for the new month
  try {
    await loadLessonStats();
    await loadLessonDates();
    renderApp();
  } catch (error) {
    console.error('Error changing month:', error);
    alert('月の切り替えに失敗しました');
  }
}

// Filter by tutor
async function filterByTutor(tutor) {
  selectedTutor = tutor;
  await renderApp();
}

// Refresh data
async function refreshData() {
  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>更新中...';
  
  try {
    // Tutor同期を個別に実行して結果を取得
    const tutorSyncRes = await axios.get(`${API_BASE}/api/tutors/sync`);
    
    // その他のデータ同期
    await loadInitialData();
    await renderApp();
    
    // 同期結果を通知
    let message = 'データを更新しました';
    if (tutorSyncRes.data.deleted > 0) {
      message += `\n\n⚠️ ${tutorSyncRes.data.deleted}人のTutorがスプレッドシートから削除されたため、DBからも削除されました`;
    }
    alert(message);
  } catch (error) {
    console.error('Error refreshing data:', error);
    alert('データの更新に失敗しました');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>データ更新';
  }
}

// Send reminders
async function sendReminders() {
  if (!confirm('明日のレッスンリマインドを送信しますか？')) {
    return;
  }
  
  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>送信中...';
  
  try {
    const res = await axios.post(`${API_BASE}/api/reminders/send`);
    alert(res.data.message);
  } catch (error) {
    console.error('Error sending reminders:', error);
    alert('リマインドの送信に失敗しました: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-bell mr-2"></i>リマインド送信';
  }
}

// Send daily statistics report
async function sendStatsReport() {
  if (!confirm('日次統計レポートをDiscordに送信しますか？')) {
    return;
  }
  
  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>送信中...';
  
  try {
    const res = await axios.post(`${API_BASE}/api/stats/send`);
    alert(res.data.message || '日次統計レポートを送信しました');
  } catch (error) {
    console.error('Error sending stats report:', error);
    alert('統計レポートの送信に失敗しました: ' + (error.response?.data?.error || error.message));
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>日次統計レポート送信';
  }
}

// ========== Students Page ==========

// Render Students Page (without payment status, reservations, and lesson dates)
function renderStudentsPage() {
  const content = document.getElementById('content');
  
  content.innerHTML = `
    <!-- Controls -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Tutor Filter -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-filter mr-2"></i>
            担当Tutor絞り込み
          </label>
          <select id="tutor-filter-students" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
            <option value="all" ${selectedTutor === 'all' ? 'selected' : ''}>すべてのTutor</option>
            ${getTutorOptions()}
          </select>
        </div>
      </div>

      <!-- Actions -->
      <div class="mt-4 flex gap-2">
        <button onclick="refreshData()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
          <i class="fas fa-sync-alt mr-2"></i>データ更新
        </button>
        <button onclick="clearAllFilters()" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition" id="clear-filters-btn">
          <i class="fas fa-times-circle mr-2"></i>フィルター・ソートをクリア
        </button>
      </div>
    </div>

    <!-- Statistics (only Active students with レッスン中 or PROプラン) -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-chart-bar mr-2"></i>
        統計情報 <span class="text-sm text-gray-500">(アクティブ・レッスン中/PROプランのみ)</span>
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        ${renderStudentStatistics()}
      </div>
    </div>

    <!-- Progress Status Legend -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-lg font-bold text-gray-800 mb-3">
        <i class="fas fa-info-circle mr-2"></i>
        レッスン進捗状況の色分け
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div class="w-8 h-8 bg-blue-100 rounded flex items-center justify-center">
            <i class="fas fa-check text-blue-600"></i>
          </div>
          <div>
            <div class="font-semibold text-gray-800">正常</div>
            <div class="text-xs text-gray-600">進捗目安の70%以上</div>
          </div>
        </div>
        <div class="flex items-center gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div class="w-8 h-8 bg-yellow-100 rounded flex items-center justify-center">
            <i class="fas fa-exclamation text-yellow-600"></i>
          </div>
          <div>
            <div class="font-semibold text-gray-800">遅い</div>
            <div class="text-xs text-gray-600">進捗目安の40%～69%</div>
          </div>
        </div>
        <div class="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div class="w-8 h-8 bg-red-100 rounded flex items-center justify-center">
            <i class="fas fa-exclamation-triangle text-red-600"></i>
          </div>
          <div>
            <div class="font-semibold text-gray-800">非常に遅い</div>
            <div class="text-xs text-gray-600">進捗目安の40%未満</div>
          </div>
        </div>
      </div>
      <div class="mt-3 text-sm text-gray-600 bg-gray-50 p-3 rounded">
        <i class="fas fa-lightbulb mr-2 text-yellow-500"></i>
        <span class="font-semibold">進捗目安の計算式:</span> 継続月数 × 2
        <span class="ml-2 text-gray-500">（例: 5ヶ月継続 → 10レッスンが目安、7レッスン = 70% = 正常）</span>
      </div>
    </div>

    <!-- Status Tabs -->
    <div class="bg-white rounded-lg shadow-md p-2 mb-6">
      <div class="flex flex-wrap gap-2">
        <button onclick="switchTab('active')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'active' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-check-circle mr-2"></i>アクティブ
        </button>
        <button onclick="switchTab('preparing')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'preparing' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-clock mr-2"></i>レッスン準備中
        </button>
        <button onclick="switchTab('suspended')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'suspended' ? 'bg-yellow-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-pause-circle mr-2"></i>休会
        </button>
        <button onclick="switchTab('graduated')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'graduated' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-user-graduate mr-2"></i>正規退会
        </button>
        <button onclick="switchTab('cancelled')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'cancelled' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-user-times mr-2"></i>無断キャンセル
        </button>
      </div>
      ${renderActiveSubTabs()}
    </div>

    <!-- Student List -->
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-list mr-2"></i>
        ${getTabTitle()}
      </h2>
      ${renderContractPlanTabs()}
      
      <!-- Sort & Filter Controls -->
      <div class="bg-gray-50 rounded-lg p-4 mb-4">
        <div class="flex flex-wrap gap-2 items-center text-sm">
          <span class="font-semibold text-gray-700">
            <i class="fas fa-sort mr-1"></i>並び替え:
          </span>
          <button onclick="toggleSort('student_id')" class="px-3 py-1 text-xs rounded ${sortColumn === 'student_id' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'} hover:shadow transition">
            学籍番号 ${sortColumn === 'student_id' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
          </button>
          <button onclick="toggleSort('name')" class="px-3 py-1 text-xs rounded ${sortColumn === 'name' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'} hover:shadow transition">
            生徒名 ${sortColumn === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
          </button>
          <button onclick="toggleSort('lesson_progress')" class="px-3 py-1 text-xs rounded ${sortColumn === 'lesson_progress' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'} hover:shadow transition">
            レッスン進捗 ${sortColumn === 'lesson_progress' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
          </button>
          <button onclick="toggleSort('continued_months')" class="px-3 py-1 text-xs rounded ${sortColumn === 'continued_months' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'} hover:shadow transition">
            継続月数 ${sortColumn === 'continued_months' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
          </button>
          <button onclick="toggleSort('result_overall')" class="px-3 py-1 text-xs rounded ${sortColumn === 'result_overall' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'} hover:shadow transition">
            リザルト ${sortColumn === 'result_overall' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
          </button>
          
          <span class="font-semibold text-gray-700 ml-4">
            <i class="fas fa-filter mr-1"></i>フィルター:
          </span>
          <button onclick="toggleFilter('student_id')" class="px-3 py-1 text-xs rounded ${columnFilters.student_id ? 'bg-green-600 text-white' : 'bg-white text-gray-700'} hover:shadow transition">
            学籍番号 ${columnFilters.student_id ? '✓' : ''}
          </button>
          <button onclick="toggleFilter('name')" class="px-3 py-1 text-xs rounded ${columnFilters.name ? 'bg-green-600 text-white' : 'bg-white text-gray-700'} hover:shadow transition">
            生徒名 ${columnFilters.name ? '✓' : ''}
          </button>
          <button onclick="toggleFilter('status')" class="px-3 py-1 text-xs rounded ${columnFilters.status ? 'bg-green-600 text-white' : 'bg-white text-gray-700'} hover:shadow transition">
            ステータス ${columnFilters.status ? '✓' : ''}
          </button>
          <button onclick="toggleFilter('homeroom_tutor')" class="px-3 py-1 text-xs rounded ${columnFilters.homeroom_tutor ? 'bg-green-600 text-white' : 'bg-white text-gray-700'} hover:shadow transition">
            Tutor ${columnFilters.homeroom_tutor ? '✓' : ''}
          </button>
          <button onclick="toggleSurveyFilter()" class="px-3 py-1 text-xs rounded ${surveyFilter === 'unreplied' ? 'bg-red-600 text-white' : 'bg-white text-gray-700'} hover:shadow transition">
            アンケート未回答 ${surveyFilter === 'unreplied' ? '✓' : ''}
          </button>
        </div>
      </div>
      
      <!-- Student Cards Container -->
      <div class="space-y-2">
        ${renderStudentRowsSimple()}
      </div>
      
      <!-- Old Table (Hidden for reference) -->
      <div class="hidden overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center gap-2">
                  <span>学籍番号</span>
                  <button onclick="toggleSort('student_id')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'student_id' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                  <button onclick="toggleFilter('student_id')" class="hover:text-blue-600 transition">
                    <i class="fas fa-filter ${columnFilters.student_id ? 'text-blue-600' : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center gap-2">
                  <span>生徒名</span>
                  <button onclick="toggleSort('name')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'name' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                  <button onclick="toggleFilter('name')" class="hover:text-blue-600 transition">
                    <i class="fas fa-filter ${columnFilters.name ? 'text-blue-600' : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center gap-2">
                  <span>ステータス</span>
                  <button onclick="toggleSort('status')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'status' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                  <button onclick="toggleFilter('status')" class="hover:text-blue-600 transition">
                    <i class="fas fa-filter ${columnFilters.status ? 'text-blue-600' : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center gap-2">
                  <span>契約プラン</span>
                  <button onclick="toggleSort('contract_plan')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'contract_plan' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                  <button onclick="toggleFilter('contract_plan')" class="hover:text-blue-600 transition">
                    <i class="fas fa-filter ${columnFilters.contract_plan ? 'text-blue-600' : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center gap-2">
                  <span>キャラ名</span>
                  <button onclick="toggleSort('character_name')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'character_name' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                  <button onclick="toggleFilter('character_name')" class="hover:text-blue-600 transition">
                    <i class="fas fa-filter ${columnFilters.character_name ? 'text-blue-600' : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center gap-2">
                  <span>担任Tutor</span>
                  <button onclick="toggleSort('homeroom_tutor')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'homeroom_tutor' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                  <button onclick="toggleFilter('homeroom_tutor')" class="hover:text-blue-600 transition">
                    <i class="fas fa-filter ${columnFilters.homeroom_tutor ? 'text-blue-600' : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center justify-center gap-2">
                  <span>レッスン進捗</span>
                  <button onclick="toggleSort('lesson_progress')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'lesson_progress' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center justify-center gap-2">
                  <span>開始日</span>
                  <button onclick="toggleSort('lesson_start_date')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'lesson_start_date' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center justify-center gap-2">
                  <span>継続月数</span>
                  <button onclick="toggleSort('continued_months')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'continued_months' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-purple-50">
                <div class="flex items-center justify-center gap-2">
                  <span class="text-purple-700">PROプラン<br>開始日</span>
                  <button onclick="toggleSort('pro_plan_start_date')" class="hover:text-purple-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'pro_plan_start_date' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-purple-50">
                <div class="flex items-center justify-center gap-2">
                  <span class="text-purple-700">PROプラン<br>継続月数</span>
                  <button onclick="toggleSort('pro_plan_continued_months')" class="hover:text-purple-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'pro_plan_continued_months' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center justify-center gap-2">
                  <span>リザルト総合</span>
                  <button onclick="toggleSort('result_overall')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'result_overall' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                  <button onclick="toggleFilter('result_overall')" class="hover:text-blue-600 transition">
                    <i class="fas fa-filter ${columnFilters.result_overall ? 'text-blue-600' : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center justify-center gap-2">
                  <span>わなみさん</span>
                  <button onclick="toggleSort('wanami_usage')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'wanami_usage' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center justify-center gap-2">
                  <span>欠席回数</span>
                  <button onclick="toggleSort('result_absence')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'result_absence' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center justify-center gap-2">
                  <i class="fas fa-clipboard-check text-blue-600"></i>
                  <span>アンケート</span>
                  <button onclick="toggleSurveyFilter()" class="hover:text-blue-600 transition" title="今月未回答でフィルター">
                    <i class="fas fa-filter ${surveyFilter === 'unreplied' ? 'text-red-600' : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center justify-center gap-2">
                  <i class="fas fa-dice text-purple-600"></i>
                  <span>ルーレット</span>
                </div>
              </th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リンク</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <!-- Old table rows removed - now using cards above -->
          </tbody>
        </table>
      </div>
      
      <!-- Filter Modals -->
      <div id="filter-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" onclick="if(event.target.id === 'filter-modal') closeFilterModal()">
        <div class="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold text-gray-800" id="filter-modal-title">フィルター</h3>
            <button onclick="closeFilterModal()" class="text-gray-400 hover:text-gray-600">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>
          <div id="filter-modal-content"></div>
          <div class="flex gap-2 mt-4">
            <button onclick="applyFilter()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              <i class="fas fa-check mr-2"></i>適用
            </button>
            <button onclick="clearFilter()" class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition">
              <i class="fas fa-times mr-2"></i>クリア
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Roulette Eligibility Criteria -->
    <div class="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg shadow-md p-6 mt-6">
      <h3 class="text-lg font-bold text-purple-800 mb-3 flex items-center">
        <i class="fas fa-dice mr-2"></i>
        ルーレット特典の達成条件
      </h3>
      <div class="bg-white rounded-lg p-4 space-y-3">
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
            <span class="text-purple-600 font-bold">1</span>
          </div>
          <div class="flex-1">
            <div class="font-semibold text-gray-800">ステータスが「アクティブ」</div>
            <div class="text-sm text-gray-600 mt-1">休会中や退会済みの生徒は対象外です</div>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
            <span class="text-purple-600 font-bold">2</span>
          </div>
          <div class="flex-1">
            <div class="font-semibold text-gray-800">延長審査結果が「延長」</div>
            <div class="text-sm text-gray-600 mt-1">延長審査に合格している必要があります</div>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
            <span class="text-purple-600 font-bold">3</span>
          </div>
          <div class="flex-1">
            <div class="font-semibold text-gray-800">アンケート回答条件</div>
            <div class="text-sm text-gray-600 mt-2 space-y-2">
              <div class="bg-blue-50 p-2 rounded">
                <span class="font-semibold">① 2026/3までにレッスン開始した生徒</span>
                <div class="ml-2">→ 回答率80%以上（例: 10ヶ月継続 → 8回以上）</div>
              </div>
              <div class="bg-green-50 p-2 rounded">
                <span class="font-semibold">② 2026/4以降にレッスン開始する生徒</span>
                <div class="ml-2">→ 6カ月連続でアンケートを回答</div>
              </div>
              <div class="bg-yellow-50 p-2 rounded">
                <span class="font-semibold">③ 2026/3までに開始で継続月数6カ月未満の生徒</span>
                <div class="ml-2">→ 2026/4から継続月数が6カ月になるまで回答率100%</div>
              </div>
              <div class="bg-purple-50 p-2 rounded mt-2">
                <i class="fas fa-info-circle mr-1"></i>
                <span class="font-semibold text-purple-700">条件達成後のリセット</span>
                <div class="ml-5 text-xs">一度条件を達成して特典を送付すると、以降は「6カ月連続でアンケート回答」が共通条件になります</div>
              </div>
            </div>
          </div>
        </div>
        <div class="border-t pt-3 mt-3">
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0">
              <i class="fas fa-gift text-yellow-500 text-xl"></i>
            </div>
            <div class="flex-1">
              <div class="font-semibold text-gray-800 mb-2">当選確率</div>
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div class="bg-yellow-50 p-2 rounded">
                  <span class="font-bold text-yellow-600">リザルト総合「S」</span>
                  <div class="text-gray-600">→ 当選確率 <span class="font-bold text-yellow-600">100%</span></div>
                </div>
                <div class="bg-green-50 p-2 rounded">
                  <span class="font-bold text-green-600">リザルト総合「A」「B」</span>
                  <div class="text-gray-600">→ 当選確率 <span class="font-bold text-green-600">50%</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Set tutor filter and add event listener
  const selectElement = document.getElementById('tutor-filter-students');
  if (selectElement) {
    selectElement.value = selectedTutor;
    selectElement.addEventListener('change', async (e) => {
      await filterByTutor(e.target.value);
    });
  }
  
  // Load Wanami usage data asynchronously (batch load for all students)
  loadWanamiUsageDataBatch();
  
  // Load survey stats asynchronously (batch load for all students)
  loadSurveyStats();
  
  // Load red list data asynchronously
  loadRedListData();
}

// Load Wanami usage data for all visible students (batch mode with cache)
async function loadWanamiUsageDataBatch() {
  try {
    // Fetch all usage counts in one API call (cached for 24 hours)
    const response = await axios.get('/api/students/wanami-usage-all');
    
    if (!response.data.success) {
      console.error('Failed to load Wanami usage data');
      return;
    }
    
    const usageCounts = response.data.data.usage_counts;
    
    // Update all loading elements
    const loadingElements = document.querySelectorAll('.wanami-usage-loading');
    
    loadingElements.forEach(element => {
      const studentId = element.getAttribute('data-student-id');
      if (!studentId) return;
      
      const count = usageCounts[studentId] || 0;
      element.innerHTML = `<span class="font-semibold text-blue-600 cursor-pointer hover:underline" onclick="showWanamiHistory('${studentId}')">${count}回</span>`;
      element.classList.remove('text-gray-400');
      element.classList.remove('wanami-usage-loading');
    });
    
    console.log(`[Wanami] Loaded usage counts for ${Object.keys(usageCounts).length} students`);
  } catch (error) {
    console.error('Error loading Wanami usage data:', error);
    
    // Fallback: show '-' for all elements
    const loadingElements = document.querySelectorAll('.wanami-usage-loading');
    loadingElements.forEach(element => {
      element.textContent = '-';
      element.classList.remove('text-gray-400');
      element.classList.remove('wanami-usage-loading');
    });
  }
}

// Show Wanami usage history modal
async function showWanamiHistory(studentId) {
  try {
    const response = await axios.get(`/api/students/${studentId}/wanami-history`);
    
    if (!response.data.success || response.data.data.history.length === 0) {
      showAlert('この生徒の使用履歴がありません', 'info');
      return;
    }
    
    const history = response.data.data.history;
    const student = students.find(s => s.student_id === studentId);
    const studentName = student ? student.name : studentId;
    
    const historyRows = history.map(h => `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 text-center text-sm text-gray-900">${h.year}年${h.month}月</td>
        <td class="px-4 py-3 text-center text-sm font-semibold text-blue-600">${h.count}回</td>
      </tr>
    `).join('');
    
    const modalHtml = `
      <div id="wanami-history-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div class="mt-3">
            <h3 class="text-lg font-bold text-gray-900 mb-4">
              <i class="fas fa-history mr-2"></i>${studentName}様 - わなみさん使用履歴
            </h3>
            <div class="mt-2 max-h-96 overflow-y-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">月</th>
                    <th class="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">使用回数</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  ${historyRows}
                </tbody>
              </table>
            </div>
            <div class="mt-4 flex justify-end">
              <button onclick="closeWanamiHistoryModal()" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition">
                <i class="fas fa-times mr-2"></i>閉じる
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  } catch (error) {
    console.error('Error showing Wanami history:', error);
    showAlert('使用履歴の取得に失敗しました', 'error');
  }
}

// Close Wanami history modal
function closeWanamiHistoryModal() {
  const modal = document.getElementById('wanami-history-modal');
  if (modal) {
    modal.remove();
  }
}

// Render student statistics (simpler version without lesson counts)
function renderStudentStatistics() {
  // Only count students with status "アクティブ" AND contract plan "レッスン中" (neither PROプラン nor 永久会員 nor 在籍プラン) OR "PROプラン"
  const activeStudents = students.filter(s => 
    s.status === 'アクティブ' && 
    (
      s.contract_plan === 'PROプラン' ||
      (s.contract_plan !== 'PROプラン' && s.contract_plan !== '永久会員' && s.contract_plan !== '在籍プラン')
    )
  );

  const total = activeStudents.length;
  
  // Count by contract plan subcategories
  const lessonStudents = activeStudents.filter(s => 
    s.contract_plan !== 'PROプラン' && 
    s.contract_plan !== '永久会員' && 
    s.contract_plan !== '在籍プラン'
  ).length;
  const proStudents = activeStudents.filter(s => s.contract_plan === 'PROプラン').length;

  return `
    <div class="bg-blue-50 p-4 rounded-lg">
      <div class="text-sm text-gray-600 mb-1">総生徒数</div>
      <div class="text-3xl font-bold text-blue-600">${total}名</div>
      <div class="text-xs text-gray-500 mt-1">アクティブ・レッスン中/PROプラン</div>
    </div>
    <div class="bg-green-50 p-4 rounded-lg">
      <div class="text-sm text-gray-600 mb-1">レッスン中</div>
      <div class="text-3xl font-bold text-green-600">${lessonStudents}名</div>
      <div class="text-xs text-gray-500 mt-1">PROプラン・永久会員・在籍プラン除く</div>
    </div>
    <div class="bg-purple-50 p-4 rounded-lg">
      <div class="text-sm text-gray-600 mb-1">PROプラン</div>
      <div class="text-3xl font-bold text-purple-600">${proStudents}名</div>
      <div class="text-xs text-gray-500 mt-1">アクティブのみ</div>
    </div>
  `;
}

// Render student rows (2-row card layout - no horizontal scroll)
function renderStudentRowsSimple() {
  const filtered = getFilteredStudents();
  
  if (filtered.length === 0) {
    return `
      <div class="px-4 py-8 text-center text-gray-500">
        <i class="fas fa-inbox text-4xl mb-2"></i>
        <p>該当する生徒が見つかりません</p>
      </div>
    `;
  }

  return filtered.map(student => {
    // Use pre-fetched Notion URL from cache (or generate from page ID as fallback)
    const notionUrl = student.notion_url || 
      (student.notion_page_id ? `https://www.notion.so/${student.notion_page_id.replace(/-/g, '')}` : null);
    
    // Discord URL from Discord destination spreadsheet
    const discordUrl = student.discord_url || null;
    
    // Result scores (総合のみ)
    const resultOverall = student.result_overall || '-';
    const resultOverallColor = getResultOverallColor(resultOverall);
    
    // Absence count
    const absenceCount = student.absence_count || 0;
    const absenceColorClass = absenceCount > 3 ? 'text-red-600 font-bold' : absenceCount > 0 ? 'text-orange-600' : 'text-gray-600';
    
    // Lesson start date and continued months (minus suspension months)
    const lessonStartDate = student.lesson_start_date ? formatDate(student.lesson_start_date) : '-';
    const suspensionMonths = student.suspension_months || 0;
    const continuedMonths = student.lesson_start_date ? calculateContinuedMonths(student.lesson_start_date, suspensionMonths) : 0;
    
    // Lesson progress status
    const lessonProgress = student.lesson_progress || 0;
    const progressStatus = getLessonProgressStatus(lessonProgress, continuedMonths);
    const rowBgColor = progressStatus.color;
    
    return `
      <!-- Student Card (Compact layout) -->
      <div class="bg-white border border-gray-200 rounded-lg p-2 mb-2 hover:shadow-md transition">
        <!-- Row 1: Basic Info -->
        <div class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-2 pb-2 border-b border-gray-100">
          <!-- Student ID & Name -->
          <div class="col-span-2 md:col-span-2">
            <div class="text-xs text-gray-500">学籍番号 / 生徒名</div>
            <div class="font-semibold text-sm text-gray-900">${student.student_id || '-'}</div>
            <div class="text-xs text-gray-700">${student.name || '-'}</div>
          </div>
          
          <!-- Status & Contract Plan -->
          <div>
            <div class="text-xs text-gray-500">ステータス</div>
            <div class="text-xs text-gray-700">${student.status || '-'}</div>
            <div class="text-xs text-gray-600">${student.contract_plan || '-'}</div>
          </div>
          
          <!-- Character Name -->
          <div>
            <div class="text-xs text-gray-500">キャラ名</div>
            <div class="text-xs text-gray-700 truncate" title="${student.character_name || '-'}">${student.character_name || '-'}</div>
          </div>
          
          <!-- Tutor -->
          <div>
            <div class="text-xs text-gray-500">担任Tutor</div>
            <div class="text-xs font-medium text-gray-700">${getTutorDisplayName(student.homeroom_tutor)}</div>
          </div>
          
          <!-- Links -->
          <div>
            <div class="text-xs text-gray-500">リンク</div>
            <div class="flex gap-1">
              ${notionUrl ? `<a href="${notionUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-blue-600 transition" title="Notion"><i class="fas fa-file-alt text-sm"></i></a>` : '<span class="text-gray-300"><i class="fas fa-file-alt text-sm"></i></span>'}
              ${discordUrl ? `<a href="${discordUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-indigo-600 transition" title="Discord"><i class="fab fa-discord text-sm"></i></a>` : '<span class="text-gray-300"><i class="fab fa-discord text-sm"></i></span>'}
              ${student.youtube_channel_id ? `<a href="${formatYouTubeUrl(student.youtube_channel_id)}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-red-600 transition" title="YouTube"><i class="fab fa-youtube text-sm"></i></a>` : '<span class="text-gray-300"><i class="fab fa-youtube text-sm"></i></span>'}
              ${student.x_account_id ? `<a href="${formatXUrl(student.x_account_id)}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-black transition" title="X"><i class="fab fa-twitter text-sm"></i></a>` : '<span class="text-gray-300"><i class="fab fa-twitter text-sm"></i></span>'}
              ${student.student_id ? `<a href="https://vtuber-school-evaluation.onrender.com/evaluation-detail?studentId=${student.student_id}&month=${getPreviousMonth()}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-orange-600 transition" title="リザルト"><i class="fas fa-chart-bar text-sm"></i></a>` : '<span class="text-gray-300"><i class="fas fa-chart-bar text-sm"></i></span>'}
              ${student.student_id ? `<button onclick="showStudentVQHistory('${student.student_id}')" class="text-gray-600 hover:text-purple-600 transition" title="VQ診断履歴"><i class="fas fa-clipboard-check text-sm"></i></button>` : '<span class="text-gray-300"><i class="fas fa-clipboard-check text-sm"></i></span>'}
            </div>
          </div>
        </div>
        
        <!-- Row 2: Stats & Data (Compact) -->
        <div class="grid grid-cols-5 md:grid-cols-11 gap-1 text-center">
          <!-- Lesson Progress -->
          <div class="${rowBgColor} rounded p-1">
            <div class="text-xs text-gray-600">進捗</div>
            <div class="text-xs font-semibold ${getLessonProgressClass(student.lesson_progress)}">
              ${student.lesson_progress === 'Proプラン' ? 'Pro' : (student.lesson_progress ? `L${student.lesson_progress}` : '-')}
            </div>
          </div>
          
          <!-- Start Date -->
          <div class="bg-gray-50 rounded p-1">
            <div class="text-xs text-gray-600">開始</div>
            <div class="text-xs text-gray-700">${lessonStartDate}</div>
          </div>
          
          <!-- Continued Months -->
          <div class="bg-blue-50 rounded p-1">
            <div class="text-xs text-gray-600">継続</div>
            <div class="text-xs font-semibold text-blue-600">${continuedMonths}月</div>
          </div>
          
          <!-- Red List -->
          <div class="bg-gray-50 rounded p-1">
            <div class="text-xs text-gray-600">
              <i class="fas fa-exclamation-triangle text-red-600 text-xs"></i>
            </div>
            <div class="red-list-loading text-gray-400 text-xs" data-student-id="${student.student_id}">
              <i class="fas fa-spinner fa-spin"></i>
            </div>
          </div>
          
          <!-- PRO Plan Start -->
          <div class="bg-purple-50 rounded p-1">
            <div class="text-xs text-gray-600">PRO</div>
            <input type="month" 
                   value="${student.pro_plan_start_date ? formatDateForMonthInput(student.pro_plan_start_date) : ''}"
                   onchange="updateProPlanStartDate('${student.student_id}', this.value)"
                   class="w-full px-1 py-0.5 border border-purple-300 rounded text-xs text-purple-700 font-semibold focus:ring-1 focus:ring-purple-500"
                   placeholder="-">
          </div>
          
          <!-- PRO Plan Months -->
          <div class="bg-purple-50 rounded p-1">
            <div class="text-xs text-gray-600">PRO月</div>
            <div class="text-xs font-semibold text-purple-700">${student.pro_plan_continued_months ? student.pro_plan_continued_months + '月' : '-'}</div>
          </div>
          
          <!-- Result Overall -->
          <div class="bg-gray-50 rounded p-1">
            <div class="text-xs text-gray-600">評価</div>
            <div class="text-xs font-semibold ${resultOverallColor}">${resultOverall}</div>
          </div>
          
          <!-- Wanami Usage -->
          <div class="bg-gray-50 rounded p-1">
            <div class="text-xs text-gray-600">わなみ</div>
            <div class="text-xs">
              <span class="wanami-usage-loading text-gray-400" data-student-id="${student.student_id}">...</span>
            </div>
          </div>
          
          <!-- Absence Count -->
          <div class="bg-gray-50 rounded p-1">
            <div class="text-xs text-gray-600">欠席</div>
            <div class="text-xs font-semibold ${absenceColorClass}">${absenceCount}</div>
          </div>
          
          <!-- Survey Status -->
          <div class="bg-gray-50 rounded p-1">
            <div class="text-xs text-gray-600">
              <i class="fas fa-clipboard-check text-blue-600 text-xs"></i>
            </div>
            <div class="survey-stats-loading text-gray-400 text-xs" data-student-id="${student.student_id}">
              <i class="fas fa-spinner fa-spin"></i>
            </div>
          </div>
          
          <!-- Roulette Result -->
          <div class="bg-gray-50 rounded p-1 col-span-5 md:col-span-1">
            <div class="text-xs text-gray-600">
              <i class="fas fa-dice text-purple-600 text-xs"></i>
            </div>
            <div class="roulette-result-loading text-gray-400 text-xs" data-student-id="${student.student_id}">
              <i class="fas fa-spinner fa-spin"></i>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ========== Tutors Page ==========

// Render Tutors Page
function renderTutorsPage() {
  const content = document.getElementById('content');
  
  content.innerHTML = `
    <!-- Controls -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <div class="flex gap-4 items-center flex-wrap">
        <!-- Month Navigation for Satisfaction Data -->
        <div class="flex items-center gap-2">
          <label class="text-sm font-medium text-gray-700">
            <i class="fas fa-calendar mr-1"></i>満足度表示月:
          </label>
          <button onclick="changeTutorStatsMonth(-1)" class="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
            <i class="fas fa-chevron-left"></i>
          </button>
          <span class="px-4 py-2 bg-gray-100 rounded font-semibold text-center min-w-[120px]">
            ${selectedTutorYear}年${selectedTutorMonth}月
          </span>
          <button onclick="changeTutorStatsMonth(1)" class="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
            <i class="fas fa-chevron-right"></i>
          </button>
        </div>
        
        <button onclick="refreshData()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
          <i class="fas fa-sync-alt mr-2"></i>データ更新
        </button>
        
        <button onclick="exportTutorSatisfactionToSheet()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
          <i class="fas fa-file-excel mr-2"></i>満足度データをスプレッドシートに書き出し
        </button>
        
        <button onclick="sendStatsReport()" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">
          <i class="fas fa-paper-plane mr-2"></i>日次統計レポート送信
        </button>
        
        <!-- Team Filter -->
        <div class="flex items-center gap-2">
          <label class="text-sm font-medium text-gray-700">チーム絞り込み:</label>
          <select 
            id="teamFilter" 
            onchange="handleTeamFilterChange(this.value)"
            class="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            ${renderTeamFilterOptions()}
          </select>
        </div>
      </div>
    </div>

    <!-- Statistics -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-chart-bar mr-2"></i>
        統計情報 <span class="text-sm text-blue-600">(${selectedTutorYear}年${selectedTutorMonth}月)</span>
        ${selectedTeam !== 'all' ? `<span class="text-sm text-blue-600">(${selectedTeam}チーム)</span>` : '<span class="text-sm text-gray-500">(全体)</span>'}
      </h2>
      ${renderTutorStatistics()}
    </div>

    <!-- Tutor List -->
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-chalkboard-teacher mr-2"></i>
        Tutor一覧 <span class="text-sm text-gray-500">(アクティブ・Tutor職種のみ)</span>
      </h2>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">従業員ID</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tutor名</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">所属チーム</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">アクティブ生徒数</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">生徒数上限</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">残り受入可能数</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">助っ人依頼</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">助っ人受諾</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リスケ回数</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン進捗</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン満足度</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">回収率</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">満足度スコア</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">わなみさん</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${renderTutorRows()}
          </tbody>
        </table>
      </div>
    </div>
    
    <!-- Monthly Absence Statistics (Leader+ only) -->
    ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'leader') ? `
    <div class="bg-white rounded-lg shadow-md p-6 mt-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-gray-800">
          <i class="fas fa-calendar-times mr-2"></i>月別不参加集計
        </h2>
        <div class="flex items-center gap-3">
          <button onclick="changeAbsenceStatsMonth(-1)" class="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition">
            <i class="fas fa-chevron-left mr-1"></i>前月
          </button>
          <span class="text-lg font-semibold text-gray-800">
            ${selectedStatsYear}年${selectedStatsMonth}月
          </span>
          <button onclick="changeAbsenceStatsMonth(1)" class="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition">
            次月<i class="fas fa-chevron-right ml-1"></i>
          </button>
        </div>
      </div>
      <div id="absence-stats-container" class="overflow-x-auto">
        <div class="text-center py-8 text-gray-500">
          <i class="fas fa-spinner fa-spin text-4xl mb-2"></i>
          <p>統計を読み込んでいます...</p>
        </div>
      </div>
    </div>
    ` : ''}
  `;
  
  // Load absence stats for current month (only for leaders and admins)
  if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'leader')) {
    fetchAbsenceStats(selectedStatsYear, selectedStatsMonth).then(() => {
      renderAbsenceStatsSection();
    });
  }
  
  // Load Wanami usage data for all tutors
  loadWanamiUsageDataForTutors();
}

// Load Wanami usage data for all tutors (sum of their students' usage)
async function loadWanamiUsageDataForTutors() {
  try {
    // Fetch all usage counts in one API call (cached for 24 hours)
    const response = await axios.get('/api/students/wanami-usage-all');
    
    if (!response.data.success) {
      console.error('Failed to load Wanami usage data for tutors');
      return;
    }
    
    const usageCounts = response.data.data.usage_counts;
    
    // Calculate team totals
    const teamTotals = {};
    
    // Update all loading elements for individual tutors
    const loadingElements = document.querySelectorAll('.wanami-usage-tutor');
    
    loadingElements.forEach(element => {
      const tutorNotionName = element.getAttribute('data-tutor-notion-name');
      if (!tutorNotionName) return;
      
      // Find the tutor to get their team
      const tutor = tutors.find(t => t.notion_name === tutorNotionName);
      const teamName = tutor ? (tutor.team || '未所属') : '未所属';
      
      // Find all students of this tutor
      const tutorStudents = students.filter(s => 
        s.homeroom_tutor === tutorNotionName &&
        s.status === 'アクティブ' &&
        s.contract_plan !== '永久会員' &&
        s.contract_plan !== '在籍プラン'
      );
      
      // Calculate total usage count for this tutor's students
      let totalCount = 0;
      tutorStudents.forEach(student => {
        totalCount += (usageCounts[student.student_id] || 0);
      });
      
      // Update team total
      if (!teamTotals[teamName]) {
        teamTotals[teamName] = 0;
      }
      teamTotals[teamName] += totalCount;
      
      element.textContent = `${totalCount}回`;
      element.classList.remove('text-gray-400');
      element.classList.add('text-blue-600', 'font-semibold');
    });
    
    // Update team statistics
    const teamElements = document.querySelectorAll('.wanami-usage-team');
    teamElements.forEach(element => {
      const teamName = element.getAttribute('data-team-name');
      if (!teamName) return;
      
      const teamTotal = teamTotals[teamName] || 0;
      element.textContent = `${teamTotal}回`;
      element.classList.remove('text-gray-400');
      element.classList.add('text-blue-600', 'font-semibold');
    });
    
    console.log(`[Wanami Tutors] Loaded usage counts for tutors and teams`);
  } catch (error) {
    console.error('Error loading Wanami usage data for tutors:', error);
    
    // Fallback: show '-' for all elements
    const loadingElements = document.querySelectorAll('.wanami-usage-tutor, .wanami-usage-team');
    loadingElements.forEach(element => {
      element.textContent = '-';
      element.classList.remove('text-gray-400');
    });
  }
}

// Render team filter options
function renderTeamFilterOptions() {
  // Get unique teams from active tutors
  const activeTutors = tutors.filter(t => 
    t.status === 'アクティブ' && 
    t.job_type && 
    t.job_type.toLowerCase().includes('tutor')
  );
  
  const teams = [...new Set(activeTutors.map(t => t.team || '未所属'))].sort();
  
  return `
    <option value="all" ${selectedTeam === 'all' ? 'selected' : ''}>全体</option>
    ${teams.map(team => `
      <option value="${team}" ${selectedTeam === team ? 'selected' : ''}>${team}</option>
    `).join('')}
  `;
}

// Handle team filter change
// Change tutor satisfaction stats month
async function changeTutorStatsMonth(delta) {
  selectedTutorMonth += delta;
  
  if (selectedTutorMonth < 1) {
    selectedTutorMonth = 12;
    selectedTutorYear--;
  } else if (selectedTutorMonth > 12) {
    selectedTutorMonth = 1;
    selectedTutorYear++;
  }
  
  console.log(`[Tutor Stats] Changed to ${selectedTutorYear}/${selectedTutorMonth}`);
  
  // Load monthly stats for the selected month
  await loadTutorMonthlyStats();
  
  renderTutorsPage();
}

function handleTeamFilterChange(team) {
  selectedTeam = team;
  renderTutorsPage();
}

// Render tutor statistics
function renderTutorStatistics() {
  // Always use all active tutors for statistics (no filter applied)
  const allActiveTutors = tutors.filter(t => 
    t.status === 'アクティブ' && 
    t.job_type && 
    t.job_type.toLowerCase().includes('tutor')
  );
  
  const selectedYearMonth = `${selectedTutorYear}/${selectedTutorMonth}`;
  
  // Get unique teams
  const uniqueTeams = [...new Set(allActiveTutors.map(t => t.team || '未所属'))].sort();
  
  // Calculate overall statistics
  let overallSatisfaction = 0;
  let overallCollectionRate = 0;
  let overallSatisfactionScore = 0;
  let overallValidCount = 0;
  
  allActiveTutors.forEach(tutor => {
    // Skip きょうへい先生 from satisfaction statistics
    if (tutor.tutor_name === 'きょうへい先生') {
      return;
    }
    
    const activeStudentCount = students.filter(s => 
      s.homeroom_tutor === tutor.notion_name &&
      s.status === 'アクティブ' &&
      s.contract_plan !== '永久会員' &&
      s.contract_plan !== '在籍プラン'
    ).length;
    
    const tutorSatisfactionData = satisfactionData[tutor.tutor_name] || {};
    const currentMonthData = tutorSatisfactionData[selectedYearMonth];
    
    if (currentMonthData && activeStudentCount > 0) {
      const satisfactionValue = currentMonthData.average * 10;
      const satisfactionCount = currentMonthData.count;
      const collectionRateValue = (satisfactionCount / activeStudentCount * 100);
      const satisfactionScoreValue = satisfactionValue * collectionRateValue / 100;
      
      overallSatisfaction += satisfactionValue;
      overallCollectionRate += collectionRateValue;
      overallSatisfactionScore += satisfactionScoreValue;
      overallValidCount++;
    }
  });
  
  const overallAvgSatisfaction = overallValidCount > 0 ? (overallSatisfaction / overallValidCount).toFixed(2) : '-';
  const overallAvgCollectionRate = overallValidCount > 0 ? (overallCollectionRate / overallValidCount).toFixed(1) : '-';
  const overallAvgSatisfactionScore = overallValidCount > 0 ? (overallSatisfactionScore / overallValidCount).toFixed(2) : '-';
  
  // Color coding for overall
  const overallSatisfactionColor = overallAvgSatisfaction !== '-' && parseFloat(overallAvgSatisfaction) < 80 ? 'text-red-600' : 'text-purple-600';
  const overallCollectionRateColor = overallAvgCollectionRate !== '-' && parseFloat(overallAvgCollectionRate) < 50 ? 'text-red-600' : 'text-green-600';
  const overallSatisfactionScoreColor = overallAvgSatisfactionScore !== '-' && parseFloat(overallAvgSatisfactionScore) < 60 ? 'text-red-600' : 'text-indigo-600';
  
  // Calculate team-specific statistics
  const teamStats = {};
  uniqueTeams.forEach(team => {
    const teamTutors = allActiveTutors.filter(t => (t.team || '未所属') === team);
    let teamSatisfaction = 0;
    let teamCollectionRate = 0;
    let teamSatisfactionScore = 0;
    let teamValidCount = 0;
    
    teamTutors.forEach(tutor => {
      // Skip きょうへい先生 from team satisfaction statistics
      if (tutor.tutor_name === 'きょうへい先生') {
        return;
      }
      
      const activeStudentCount = students.filter(s => 
        s.homeroom_tutor === tutor.notion_name &&
        s.status === 'アクティブ' &&
        s.contract_plan !== '永久会員' &&
        s.contract_plan !== '在籍プラン'
      ).length;
      
      const tutorSatisfactionData = satisfactionData[tutor.tutor_name] || {};
      const currentMonthData = tutorSatisfactionData[selectedYearMonth];
      
      if (currentMonthData && activeStudentCount > 0) {
        const satisfactionValue = currentMonthData.average * 10;
        const satisfactionCount = currentMonthData.count;
        const collectionRateValue = (satisfactionCount / activeStudentCount * 100);
        const satisfactionScoreValue = satisfactionValue * collectionRateValue / 100;
        
        teamSatisfaction += satisfactionValue;
        teamCollectionRate += collectionRateValue;
        teamSatisfactionScore += satisfactionScoreValue;
        teamValidCount++;
      }
    });
    
    teamStats[team] = {
      tutorCount: teamTutors.length,
      satisfaction: teamValidCount > 0 ? (teamSatisfaction / teamValidCount).toFixed(2) : '-',
      collectionRate: teamValidCount > 0 ? (teamCollectionRate / teamValidCount).toFixed(1) : '-',
      satisfactionScore: teamValidCount > 0 ? (teamSatisfactionScore / teamValidCount).toFixed(2) : '-',
      wanamiUsage: 0  // Will be populated later from API
    };
  });
  
  return `
    <!-- Overall Statistics -->
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-3">
        <i class="fas fa-globe mr-2"></i>全体統計
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div class="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
          <div class="text-sm text-gray-600 mb-1">アクティブTutor数</div>
          <div class="text-3xl font-bold text-blue-600">${allActiveTutors.length}名</div>
        </div>
        <div class="bg-green-50 p-4 rounded-lg border-2 border-green-200">
          <div class="text-sm text-gray-600 mb-1">所属チーム数</div>
          <div class="text-3xl font-bold text-green-600">${uniqueTeams.length}チーム</div>
        </div>
        <div class="bg-purple-50 p-4 rounded-lg border-2 border-purple-200">
          <div class="text-sm text-gray-600 mb-1">満足度平均</div>
          <div class="text-3xl font-bold ${overallSatisfactionColor}">${overallAvgSatisfaction}</div>
        </div>
        <div class="bg-green-50 p-4 rounded-lg border-2 border-green-200">
          <div class="text-sm text-gray-600 mb-1">回収率平均</div>
          <div class="text-3xl font-bold ${overallCollectionRateColor}">${overallAvgCollectionRate}${overallAvgCollectionRate !== '-' ? '%' : ''}</div>
        </div>
        <div class="bg-indigo-50 p-4 rounded-lg border-2 border-indigo-200">
          <div class="text-sm text-gray-600 mb-1">満足度スコア平均</div>
          <div class="text-3xl font-bold ${overallSatisfactionScoreColor}">${overallAvgSatisfactionScore}</div>
        </div>
      </div>
    </div>
    
    <!-- Team-by-Team Statistics -->
    <div>
      <h3 class="text-lg font-semibold text-gray-800 mb-3">
        <i class="fas fa-users mr-2"></i>チーム別統計
      </h3>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 border border-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">チーム名</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Tutor数</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">満足度平均</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">回収率平均</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">満足度スコア平均</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">わなみさん合計</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${uniqueTeams
              .filter(team => {
                const stats = teamStats[team];
                // TUTOR数が2名以下のチームは非表示
                return stats.tutorCount > 2;
              })
              .map(team => {
              const stats = teamStats[team];
              const satisfactionColor = stats.satisfaction !== '-' && parseFloat(stats.satisfaction) < 80 ? 'text-red-600' : 'text-purple-600';
              const collectionRateColor = stats.collectionRate !== '-' && parseFloat(stats.collectionRate) < 50 ? 'text-red-600' : 'text-green-600';
              const satisfactionScoreColor = stats.satisfactionScore !== '-' && parseFloat(stats.satisfactionScore) < 60 ? 'text-red-600' : 'text-indigo-600';
              
              return `
                <tr class="hover:bg-gray-50">
                  <td class="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">${team}</td>
                  <td class="px-4 py-3 whitespace-nowrap text-sm text-center text-blue-600 font-semibold">${stats.tutorCount}名</td>
                  <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-bold ${satisfactionColor}">${stats.satisfaction}</td>
                  <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-bold ${collectionRateColor}">${stats.collectionRate}${stats.collectionRate !== '-' ? '%' : ''}</td>
                  <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-bold ${satisfactionScoreColor}">${stats.satisfactionScore}</td>
                  <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold text-blue-600">
                    <span class="wanami-usage-team text-gray-400" data-team-name="${team}">...</span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Render tutor rows
function renderTutorRows() {
  // Filter: Only show tutors with status='アクティブ' AND job_type contains 'Tutor'
  let filteredTutors = tutors.filter(t => 
    t.status === 'アクティブ' && 
    t.job_type && 
    t.job_type.toLowerCase().includes('tutor')
  );
  
  // Apply team filter
  if (selectedTeam !== 'all') {
    filteredTutors = filteredTutors.filter(t => (t.team || '未所属') === selectedTeam);
  }
  
  if (filteredTutors.length === 0) {
    return `
      <tr>
        <td colspan="14" class="px-4 py-8 text-center text-gray-500">
          <i class="fas fa-inbox text-4xl mb-2"></i>
          <p>アクティブなTutorが見つかりません</p>
        </td>
      </tr>
    `;
  }

  // Get selected month in YYYY/M format
  const selectedYearMonth = `${selectedTutorYear}/${selectedTutorMonth}`;

  return filteredTutors.map(tutor => {
    const statusClass = tutor.status === 'アクティブ' ? 'text-green-600 font-semibold' : 'text-gray-600';
    
    // Calculate active student count for this tutor
    // IMPORTANT: Matching by tutor.notion_name (Notion名で照合)
    // homeroom_tutor field in students contains Notion名 (e.g., "Satomi", "Macky")
    // Count only students with status='アクティブ'
    // Exclude contract_plan: '永久会員' and '在籍プラン'
    const activeStudentCount = students.filter(s => 
      s.homeroom_tutor === tutor.notion_name &&
      s.status === 'アクティブ' &&
      s.contract_plan !== '永久会員' &&
      s.contract_plan !== '在籍プラン'
    ).length;
    
    // Student capacity (手入力、デフォルトは未設定)
    const studentCapacity = tutor.student_capacity || '-';
    
    // Remaining capacity
    let remainingCapacity = '-';
    if (tutor.student_capacity && !isNaN(tutor.student_capacity)) {
      const remaining = tutor.student_capacity - activeStudentCount;
      remainingCapacity = remaining;
      
      // Color code based on remaining capacity
      if (remaining <= 0) {
        remainingCapacity = `<span class="text-red-600 font-bold">${remaining}</span>`;
      } else if (remaining <= 2) {
        remainingCapacity = `<span class="text-orange-600 font-semibold">${remaining}</span>`;
      } else {
        remainingCapacity = `<span class="text-green-600">${remaining}</span>`;
      }
    }
    
    // Check if this is きょうへい先生 (hide satisfaction data)
    const isKyoheiSensei = tutor.tutor_name === 'きょうへい先生';
    
    // Get satisfaction data for this tutor
    const tutorSatisfactionData = satisfactionData[tutor.tutor_name] || {};
    const currentMonthData = tutorSatisfactionData[selectedYearMonth];
    
    // レッスン満足度 (平均 × 10、100がMAX、小数第2位まで)
    let satisfactionAverage = '-';
    let satisfactionValue = 0;
    let satisfactionColor = 'text-purple-600'; // デフォルト色
    if (!isKyoheiSensei && currentMonthData) {
      satisfactionValue = currentMonthData.average * 10; // 0-10 → 0-100
      satisfactionAverage = satisfactionValue.toFixed(2);
      // 80未満は赤文字
      if (satisfactionValue < 80) {
        satisfactionColor = 'text-red-600';
      }
    }
    const satisfactionCount = currentMonthData ? currentMonthData.count : 0;
    
    // 回収率 (アクティブ生徒数 / 表示月の満足度件数 × 100)
    let collectionRate = '-';
    let collectionRateValue = 0;
    let collectionRateColor = 'text-green-600'; // デフォルト色
    if (!isKyoheiSensei && activeStudentCount > 0 && satisfactionCount > 0) {
      collectionRateValue = (satisfactionCount / activeStudentCount * 100);
      collectionRate = `${collectionRateValue.toFixed(1)}%`;
      // 50未満は赤文字
      if (collectionRateValue < 50) {
        collectionRateColor = 'text-red-600';
      }
    } else if (!isKyoheiSensei && activeStudentCount > 0 && satisfactionCount === 0) {
      collectionRate = '0.0%';
      collectionRateColor = 'text-red-600'; // 0%は赤文字
    }
    
    // 満足度スコア (レッスン満足度 × 回収率(数値) / 100)
    // 例: 満足度99.63, 回収率25% → 99.63 × 25 / 100 = 24.9075 → 24.91
    let satisfactionScore = '-';
    let satisfactionScoreValue = 0;
    let satisfactionScoreColor = 'text-indigo-600'; // デフォルト色
    if (!isKyoheiSensei && satisfactionValue > 0 && collectionRateValue > 0) {
      satisfactionScoreValue = satisfactionValue * collectionRateValue / 100;
      satisfactionScore = satisfactionScoreValue.toFixed(2); // 小数第2位まで
      // 60未満は赤文字
      if (satisfactionScoreValue < 60) {
        satisfactionScoreColor = 'text-red-600';
      }
    }
    
    // 満足度ボタン (表示月にデータがある場合のみ表示、きょうへい先生は非表示)
    const satisfactionButton = (!isKyoheiSensei && currentMonthData) ? 
      `<button 
        onclick="showSatisfactionModal('${tutor.tutor_name}')" 
        class="text-blue-600 hover:text-blue-800 ml-2"
        title="満足度詳細を表示">
        <i class="fas fa-chart-line"></i>
      </button>` : '';
    
    // レッスン進捗ステータス
    const progressStatus = getTutorLessonProgressStatus(tutor.notion_name);
    const progressCircle = progressStatus.count > 0
      ? `<div 
          class="w-8 h-8 rounded-full ${progressStatus.color} mx-auto cursor-pointer"
          title="正常: ${progressStatus.normal}名, 遅い: ${progressStatus.slow}名 (${progressStatus.slowRate}%), 非常に遅い: ${progressStatus.verySlow}名 (${progressStatus.verySlowRate}%)"
        ></div>`
      : `<div class="w-8 h-8 rounded-full bg-gray-200 mx-auto" title="データなし"></div>`;
    
    // カウンター色を計算（助っ人依頼とリスケ回数）
    const getCounterColor = (count) => {
      if (count >= 10) return 'text-red-600';
      if (count >= 5) return 'text-orange-600';
      return 'text-gray-900';
    };
    
    // Get monthly counts from tutorMonthlyStats (based on selected month)
    const tutorIdStats = tutorMonthlyStats.byEmployeeId[tutor.employee_id] || {};
    const helperRequestCount = tutorIdStats.helperRequestCount || 0;
    const helperAcceptedCount = tutorIdStats.helperAcceptedCount || 0;
    const rescheduleCount = tutorMonthlyStats.rescheduleByName[tutor.tutor_name] || 0;
    
    const requestColor = getCounterColor(helperRequestCount);
    const rescheduleColor = getCounterColor(rescheduleCount);
    
    // わなみさん使用回数（担当生徒の合計）
    const wanamiUsage = `<span class="wanami-usage-tutor text-gray-400" data-tutor-notion-name="${tutor.notion_name}">...</span>`;
    
    return `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${tutor.employee_id || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${tutor.tutor_name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${tutor.team || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold text-blue-600">${activeStudentCount}名</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center">
          <input 
            type="number" 
            value="${tutor.student_capacity || ''}" 
            placeholder="-"
            class="w-16 px-2 py-1 text-center border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            onchange="updateTutorCapacity('${tutor.employee_id}', this.value)"
            min="0"
          />
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold">${remainingCapacity}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold ${requestColor}">${helperRequestCount}回</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold text-gray-900">${helperAcceptedCount}回</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold ${rescheduleColor}">${rescheduleCount}回</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center">${progressCircle}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center">
          <span class="font-semibold ${satisfactionColor}">${satisfactionAverage}</span>
          ${satisfactionButton}
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold ${collectionRateColor}">${collectionRate}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-bold ${satisfactionScoreColor}">${satisfactionScore}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold text-blue-600">${wanamiUsage}</td>
      </tr>
    `;
  }).join('');
}

// Update tutor student capacity
async function updateTutorCapacity(employeeId, capacity) {
  try {
    const capacityValue = capacity === '' ? null : parseInt(capacity, 10);
    
    const response = await axios.put(`${API_BASE}/api/tutors/${employeeId}/capacity`, {
      student_capacity: capacityValue
    });
    
    if (response.data.success) {
      // Update local tutor data
      const tutor = tutors.find(t => t.employee_id === employeeId);
      if (tutor) {
        tutor.student_capacity = capacityValue;
      }
      
      // Re-render tutors page to update remaining capacity
      renderTutorsPage();
      
      console.log('生徒数上限を更新しました');
    } else {
      alert('生徒数上限の更新に失敗しました');
    }
  } catch (error) {
    console.error('Error updating tutor capacity:', error);
    alert('生徒数上限の更新中にエラーが発生しました');
  }
}

// Export tutor satisfaction data to spreadsheet
async function exportTutorSatisfactionToSheet() {
  try {
    const button = event.target.closest('button');
    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>書き出し中...';
    
    // Ensure tutors data is loaded
    if (!tutors || tutors.length === 0) {
      console.log('[Export] Tutors not loaded, loading now...');
      try {
        const tutorsRes = await axios.get(`${API_BASE}/api/tutors`);
        tutors = tutorsRes.data.data;
        console.log('[Export] Loaded', tutors.length, 'tutors');
      } catch (error) {
        console.error('[Export] Failed to load tutors:', error);
        alert('Tutorデータの読み込みに失敗しました');
        button.disabled = false;
        button.innerHTML = originalHTML;
        return;
      }
    }
    
    // Ensure satisfaction data is loaded
    if (!satisfactionData || Object.keys(satisfactionData).length === 0) {
      console.log('[Export] Satisfaction data not loaded, loading now...');
      try {
        const res = await axios.get(`${API_BASE}/api/tutors/satisfaction/all`);
        satisfactionData = res.data.data || {};
        console.log('[Export] Loaded satisfaction data for', Object.keys(satisfactionData).length, 'tutors');
      } catch (error) {
        console.error('[Export] Failed to load satisfaction data:', error);
        alert('満足度データの読み込みに失敗しました');
        button.disabled = false;
        button.innerHTML = originalHTML;
        return;
      }
    }
    
    // Collect all unique months from satisfactionData
    const allMonths = new Set();
    Object.values(satisfactionData).forEach(tutorData => {
      Object.keys(tutorData).forEach(yearMonth => {
        allMonths.add(yearMonth);
      });
    });
    
    // Sort months (oldest first)
    const sortedMonths = Array.from(allMonths).sort((a, b) => {
      const [yearA, monthA] = a.split('/').map(Number);
      const [yearB, monthB] = b.split('/').map(Number);
      return yearA !== yearB ? yearA - yearB : monthA - monthB;
    });
    
    if (sortedMonths.length === 0) {
      alert('満足度データがありません');
      button.disabled = false;
      button.innerHTML = originalHTML;
      return;
    }
    
    // Get active tutors (excluding きょうへい先生)
    console.log('[Export] Total tutors:', tutors.length);
    if (tutors.length > 0) {
      console.log('[Export] First 3 tutors:', tutors.slice(0, 3));
      console.log('[Export] Sample tutor structure:', {
        name: tutors[0].name,
        tutor_name: tutors[0].tutor_name,
        status: tutors[0].status,
        job_type: tutors[0].job_type
      });
    }
    
    // First, let's see all tutors with 'tutor' in job_type
    const allTutorsByJobType = tutors.filter(t => t.job_type && t.job_type.toLowerCase().includes('tutor'));
    console.log('[Export] Tutors with job_type containing "tutor":', allTutorsByJobType.length);
    
    if (allTutorsByJobType.length > 0) {
      console.log('[Export] Sample tutor with job_type:', {
        name: allTutorsByJobType[0].tutor_name,
        status: allTutorsByJobType[0].status,
        job_type: allTutorsByJobType[0].job_type
      });
      
      // Show unique status values
      const uniqueStatuses = [...new Set(allTutorsByJobType.map(t => t.status))];
      console.log('[Export] Unique status values for tutors:', uniqueStatuses);
    }
    
    const activeTutors = tutors.filter(t => {
      const isActive = t.status === 'アクティブ';
      const hasJobType = t.job_type && t.job_type.toLowerCase().includes('tutor');
      const notKyohei = t.tutor_name !== 'きょうへい先生';
      
      if (!isActive && hasJobType) {
        console.log(`[Export] Tutor ${t.tutor_name || t.name} excluded: status = "${t.status}" (expected "アクティブ")`);
      }
      
      return isActive && hasJobType && notKyohei;
    });
    
    console.log('[Export] Active tutors after filtering:', activeTutors.length);
    console.log('[Export] Satisfaction data keys:', Object.keys(satisfactionData).length);
    console.log('[Export] Sorted months:', sortedMonths);
    
    if (activeTutors.length === 0) {
      console.error('[Export] No active tutors found.');
      console.error('[Export] Possible solutions:');
      console.error('  1. Check if status field exactly matches "アクティブ" (no extra spaces)');
      console.error('  2. Verify job_type contains "tutor"');
      console.error('  3. Check database/Notion sync');
      alert('アクティブなTutorが見つかりません\n\nコンソールログを確認してください（F12キー）');
      button.disabled = false;
      button.innerHTML = originalHTML;
      return;
    }
    
    // Prepare data rows
    const rows = [];
    
    // Header row
    const headerRow = ['Tutor名', '項目', ...sortedMonths];
    rows.push(headerRow);
    
    // Data rows for each tutor
    activeTutors.forEach(tutor => {
      const tutorName = tutor.tutor_name;
      const tutorSatisfactionData = satisfactionData[tutorName] || {};
      
      console.log(`[Export] Processing tutor: ${tutorName}, has data:`, Object.keys(tutorSatisfactionData).length > 0);
      
      // Row 1: レッスン満足度
      const satisfactionRow = [tutorName, 'レッスン満足度'];
      sortedMonths.forEach(month => {
        const monthData = tutorSatisfactionData[month];
        satisfactionRow.push(monthData ? monthData.average.toFixed(2) : '');
      });
      rows.push(satisfactionRow);
      
      // Row 2: 回収率
      const collectionRow = ['', '回収率'];
      sortedMonths.forEach(month => {
        const monthData = tutorSatisfactionData[month];
        if (monthData) {
          // Calculate active student count for this tutor
          const activeStudentCount = students.filter(s => 
            s.homeroom_tutor === tutor.notion_name &&
            s.status === 'アクティブ' &&
            s.contract_plan !== '永久会員' &&
            s.contract_plan !== '在籍プラン'
          ).length;
          
          const collectionRate = activeStudentCount > 0 
            ? ((monthData.count / activeStudentCount) * 100).toFixed(2)
            : '0.00';
          collectionRow.push(collectionRate);
        } else {
          collectionRow.push('');
        }
      });
      rows.push(collectionRow);
      
      // Row 3: 満足度スコア
      const scoreRow = ['', '満足度スコア'];
      sortedMonths.forEach(month => {
        const monthData = tutorSatisfactionData[month];
        if (monthData) {
          const activeStudentCount = students.filter(s => 
            s.homeroom_tutor === tutor.notion_name &&
            s.status === 'アクティブ' &&
            s.contract_plan !== '永久会員' &&
            s.contract_plan !== '在籍プラン'
          ).length;
          
          const collectionRate = activeStudentCount > 0 
            ? (monthData.count / activeStudentCount) * 100
            : 0;
          
          const satisfactionScore = (monthData.average * collectionRate / 100).toFixed(2);
          scoreRow.push(satisfactionScore);
        } else {
          scoreRow.push('');
        }
      });
      rows.push(scoreRow);
    });
    
    console.log('[Export] Total rows prepared:', rows.length);
    console.log('[Export] Sample row 0 (header):', rows[0]);
    if (rows.length > 1) {
      console.log('[Export] Sample row 1 (first tutor):', rows[1]);
    }
    
    // Send to backend API
    console.log('[Export] Sending', rows.length, 'rows to backend...');
    const response = await axios.post(`${API_BASE}/api/tutors/export-satisfaction`, {
      rows: rows,
      sortedMonths: sortedMonths,
      isManualExport: true
    }, {
      headers: { 'Authorization': `Bearer ${sessionToken}` },
      timeout: 120000 // 120 seconds timeout for large exports
    });
    
    console.log('[Export] Received response:', response.data);
    
    if (response.data.success) {
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50';
      notification.innerHTML = `
        <i class="fas fa-check-circle mr-2"></i>
        スプレッドシートに書き出しました<br>
        <a href="${response.data.spreadsheetUrl}" target="_blank" class="underline text-sm">スプレッドシートを開く</a>
      `;
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.remove();
      }, 5000);
      
      console.log('[Export] Satisfaction data exported to spreadsheet:', response.data.spreadsheetUrl);
    } else {
      const errorMsg = response.data.error || '不明なエラー';
      console.error('[Export] Export failed:', errorMsg);
      alert('書き出しに失敗しました: ' + errorMsg);
    }
  } catch (error) {
    console.error('[Export] Error exporting satisfaction data:', error);
    const errorMsg = error.response?.data?.error || error.message || 'ネットワークエラー';
    alert('書き出し中にエラーが発生しました: ' + errorMsg);
  } finally {
    const button = event.target.closest('button');
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-file-excel mr-2"></i>満足度データをスプレッドシートに書き出し';
  }
}

// Show satisfaction modal for a tutor
function showSatisfactionModal(tutorName) {
  const tutorSatisfactionData = satisfactionData[tutorName] || {};
  const currentYearMonth = `${currentMonth.getFullYear()}/${currentMonth.getMonth() + 1}`;
  const currentMonthData = tutorSatisfactionData[currentYearMonth];
  
  if (!currentMonthData) {
    alert('表示月の満足度データがありません');
    return;
  }
  
  // Get tutor's notion_name for student count calculation
  const tutor = tutors.find(t => t.tutor_name === tutorName);
  if (!tutor) {
    alert('Tutor情報が見つかりません');
    return;
  }
  
  // Calculate active student count
  const activeStudentCount = students.filter(s => 
    s.homeroom_tutor === tutor.notion_name &&
    s.status === 'アクティブ' &&
    s.contract_plan !== '永久会員' &&
    s.contract_plan !== '在籍プラン'
  ).length;
  
  // Build reasons list, separated by score
  const highScoreReasons = currentMonthData.reasons.filter(r => r.score >= 9);
  const lowScoreReasons = currentMonthData.reasons.filter(r => r.score <= 8);
  
  const highScoreHtml = highScoreReasons.map(r => `
    <div class="border-b border-gray-200 py-3">
      <div class="flex justify-between items-start mb-1">
        <span class="font-semibold text-gray-800">${r.studentName}</span>
        <span class="text-sm text-green-600 font-semibold">評価: ${r.score}</span>
      </div>
      <p class="text-sm text-gray-600">${r.reason}</p>
    </div>
  `).join('');
  
  const lowScoreHtml = lowScoreReasons.map(r => `
    <div class="border-b border-gray-200 py-3">
      <div class="flex justify-between items-start mb-1">
        <span class="font-semibold text-gray-800">${r.studentName}</span>
        <span class="text-sm text-orange-600 font-semibold">評価: ${r.score}</span>
      </div>
      <p class="text-sm text-gray-600">${r.reason}</p>
    </div>
  `).join('');
  
  const reasonsHtml = `
    ${highScoreReasons.length > 0 ? `
      <div class="mb-4">
        <h5 class="font-semibold text-green-700 mb-2 flex items-center">
          <i class="fas fa-smile mr-2"></i>
          高評価（9以上）${highScoreReasons.length}件
        </h5>
        <div class="border border-green-200 rounded-lg p-3 bg-green-50">
          ${highScoreHtml}
        </div>
      </div>
    ` : ''}
    ${lowScoreReasons.length > 0 ? `
      <div>
        <h5 class="font-semibold text-orange-700 mb-2 flex items-center">
          <i class="fas fa-meh mr-2"></i>
          改善余地（8以下）${lowScoreReasons.length}件
        </h5>
        <div class="border border-orange-200 rounded-lg p-3 bg-orange-50">
          ${lowScoreHtml}
        </div>
      </div>
    ` : ''}
  `;
  
  // Build historical chart data (all months with data)
  const months = Object.keys(tutorSatisfactionData).sort();
  const chartData = months.map(m => {
    const data = tutorSatisfactionData[m];
    // レッスン満足度: 平均 × 10 (0-10 → 0-100)
    const satisfactionValue = data.average * 10;
    // 回収率: 件数 ÷ アクティブ生徒数 × 100
    const collectionRate = activeStudentCount > 0 ? (data.count / activeStudentCount * 100) : 0;
    // 満足度スコア: レッスン満足度 × 回収率(数値) / 100
    const satisfactionScore = satisfactionValue * collectionRate / 100;
    
    return {
      month: m,
      average: data.average,
      satisfactionValue: satisfactionValue, // 0-100スケール
      count: data.count,
      collectionRate: collectionRate,
      satisfactionScore: satisfactionScore
    };
  });
  
  const chartLabels = chartData.map(d => d.month.replace('/', '年') + '月');
  const chartSatisfactionValues = chartData.map(d => d.satisfactionValue); // 0-100スケールの満足度
  const chartCounts = chartData.map(d => d.count);
  const chartScores = chartData.map(d => d.satisfactionScore);
  
  // Calculate current month values
  const currentSatisfactionValue = currentMonthData.average * 10; // 0-100スケール
  const currentCollectionRate = activeStudentCount > 0 ? (currentMonthData.count / activeStudentCount * 100) : 0;
  const currentSatisfactionScore = currentSatisfactionValue * currentCollectionRate / 100;
  
  // Color coding for modal summary
  const modalSatisfactionColor = currentSatisfactionValue < 80 ? 'text-red-600' : 'text-purple-600';
  const modalCollectionRateColor = currentCollectionRate < 50 ? 'text-red-600' : 'text-green-600';
  const modalSatisfactionScoreColor = currentSatisfactionScore < 60 ? 'text-red-600' : 'text-indigo-600';
  
  // Create modal
  const modalHtml = `
    <div id="satisfactionModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onclick="closeSatisfactionModal(event)">
      <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">
        <div class="p-6">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-2xl font-bold text-gray-800">
              <i class="fas fa-chart-line mr-2"></i>
              ${tutorName} - レッスン満足度
            </h3>
            <button onclick="closeSatisfactionModal()" class="text-gray-500 hover:text-gray-700">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>
          
          <!-- Current month summary -->
          <div class="bg-purple-50 rounded-lg p-4 mb-6">
            <h4 class="font-semibold text-gray-800 mb-2">表示月 (${currentYearMonth.replace('/', '年')}月)</h4>
            <div class="grid grid-cols-4 gap-4">
              <div>
                <div class="text-sm text-gray-600">レッスン満足度</div>
                <div class="text-3xl font-bold ${modalSatisfactionColor}">${currentSatisfactionValue.toFixed(2)}</div>
              </div>
              <div>
                <div class="text-sm text-gray-600">回答数</div>
                <div class="text-3xl font-bold text-blue-600">${currentMonthData.count}件</div>
              </div>
              <div>
                <div class="text-sm text-gray-600">回収率</div>
                <div class="text-3xl font-bold ${modalCollectionRateColor}">${currentCollectionRate.toFixed(1)}%</div>
              </div>
              <div>
                <div class="text-sm text-gray-600">満足度スコア</div>
                <div class="text-3xl font-bold ${modalSatisfactionScoreColor}">${currentSatisfactionScore.toFixed(2)}</div>
              </div>
            </div>
          </div>
          
          <!-- Historical chart -->
          <div class="mb-6">
            <h4 class="font-semibold text-gray-800 mb-3">過去の満足度推移</h4>
            <canvas id="satisfactionChart"></canvas>
          </div>
          
          <!-- Reasons list -->
          <div>
            <h4 class="font-semibold text-gray-800 mb-3">表示月のフィードバック (${currentMonthData.count}件)</h4>
            <div class="max-h-96 overflow-y-auto">
              ${reasonsHtml}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  // Render chart
  setTimeout(() => {
    const ctx = document.getElementById('satisfactionChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartLabels,
        datasets: [
          {
            label: 'レッスン満足度 (0-100)',
            data: chartSatisfactionValues,
            borderColor: 'rgb(147, 51, 234)',
            backgroundColor: 'rgba(147, 51, 234, 0.1)',
            yAxisID: 'y',
            tension: 0.3
          },
          {
            label: '回答数',
            data: chartCounts,
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            yAxisID: 'y1',
            tension: 0.3
          },
          {
            label: '満足度スコア',
            data: chartScores,
            borderColor: 'rgb(99, 102, 241)',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            yAxisID: 'y',
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        interaction: {
          mode: 'index',
          intersect: false
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: {
              display: true,
              text: 'レッスン満足度 / 満足度スコア'
            },
            min: 0,
            max: 100
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: {
              display: true,
              text: '回答数'
            },
            grid: {
              drawOnChartArea: false
            }
          }
        }
      }
    });
  }, 100);
}

// Close satisfaction modal
function closeSatisfactionModal(event) {
  if (event && event.target.id !== 'satisfactionModal') return;
  const modal = document.getElementById('satisfactionModal');
  if (modal) {
    modal.remove();
  }
}

// ========== Helper Functions ==========

// Get lesson progress status color
function getLessonProgressStatus(lessonProgress, continuedMonths) {
  if (!lessonProgress || !continuedMonths || continuedMonths === 0) {
    return { color: '', label: '' };
  }
  
  const expectedProgress = continuedMonths * 2;
  const progressRate = lessonProgress / expectedProgress;
  
  if (progressRate >= 0.7) {
    return { color: 'bg-blue-100', label: '正常' };
  } else if (progressRate >= 0.4) {
    return { color: 'bg-yellow-100', label: '遅い' };
  } else {
    return { color: 'bg-red-100', label: '非常に遅い' };
  }
}

// Get result overall color class
function getResultOverallColor(result) {
  if (!result || result === '-') return 'text-gray-600';
  
  const upper = result.toUpperCase();
  if (upper === 'S') return 'text-purple-600 font-bold';
  if (upper === 'A') return 'text-blue-600 font-bold';
  if (upper === 'B') return 'text-green-600';
  if (upper === 'C') return 'text-yellow-600';
  if (upper === 'D') return 'text-red-600';
  return 'text-gray-600';
}

// ========== Today's Lessons Page ==========

// Render Today's Lessons Page
// 現在表示中のレッスン日付（デフォルトは今日）
let currentLessonDate = new Date();

async function renderTodayLessonsPage() {
  const content = document.getElementById('content');
  
  // Load today's lesson dates (always loads current month)
  await loadTodayLessonDates();
  
  // Get display date (can be today, yesterday, or tomorrow)
  const displayDate = new Date(currentLessonDate);
  
  // Load lesson report status for display date
  const displayDateStr = `${displayDate.getFullYear()}-${String(displayDate.getMonth() + 1).padStart(2, '0')}-${String(displayDate.getDate()).padStart(2, '0')}`;
  await loadLessonReportStatus(displayDateStr);
  const displayDay = displayDate.getDate();
  const displayMonth = displayDate.getMonth() + 1;
  
  console.log(`Display date: ${displayMonth}/${displayDay}`);
  console.log('Total students:', students.length);
  console.log('Lesson dates sample:', Object.keys(lessonDates).slice(0, 5).map(id => ({
    id,
    dates: lessonDates[id].map(d => d.formatted)
  })));
  
  // Filter students who have lessons on the display date
  let dayStudents = students.filter(student => {
    const dates = lessonDates[student.student_id] || [];
    const hasLessonOnDate = dates.some(d => {
      // Compare formatted date strings (M/D format)
      const dateFormatted = `${displayMonth}/${displayDay}`;
      return d.formatted === dateFormatted;
    });
    return hasLessonOnDate;
  });
  
  console.log('Day students count (before filter):', dayStudents.length);
  console.log('Selected tutor:', selectedTutor);
  
  // Apply tutor filter
  if (selectedTutor !== 'all') {
    console.log('Filtering by tutor:', selectedTutor);
    dayStudents = dayStudents.filter(s => s.homeroom_tutor === selectedTutor);
    console.log('Day students count (after filter):', dayStudents.length);
  }
  
  const today = new Date();
  const isToday = displayDate.toDateString() === today.toDateString();
  const dateLabel = isToday ? '今日のレッスン' : 'レッスン一覧';

  content.innerHTML = `
    <!-- Custom Styles -->
    <style>
      @keyframes pulse-glow {
        0%, 100% {
          opacity: 1;
          box-shadow: 0 4px 6px -1px rgba(251, 191, 36, 0.5), 0 2px 4px -1px rgba(251, 191, 36, 0.3);
        }
        50% {
          opacity: 0.8;
          box-shadow: 0 10px 15px -3px rgba(251, 191, 36, 0.7), 0 4px 6px -2px rgba(251, 191, 36, 0.5);
        }
      }
      .animate-pulse-glow {
        animation: pulse-glow 2s ease-in-out infinite;
      }
    </style>
    
    <!-- Header with Date Navigation -->
    <div class="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg shadow-lg p-6 mb-6 text-white">
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <h2 class="text-2xl font-bold mb-2 flex items-center gap-3">
            <button onclick="changeLessonDate(-1)" class="px-3 py-1 bg-white/20 hover:bg-white/30 rounded transition">
              <i class="fas fa-chevron-left"></i>
            </button>
            <span>
              <i class="fas fa-calendar-day mr-2"></i>
              ${dateLabel} (${displayDate.getFullYear()}年${displayMonth}月${displayDay}日)
              ${isToday ? '<span class="text-xs bg-yellow-400 text-blue-900 px-2 py-1 rounded ml-2">TODAY</span>' : ''}
            </span>
            <button onclick="changeLessonDate(1)" class="px-3 py-1 bg-white/20 hover:bg-white/30 rounded transition">
              <i class="fas fa-chevron-right"></i>
            </button>
            ${!isToday ? `<button onclick="resetToToday()" class="px-3 py-2 text-sm bg-yellow-400 text-blue-900 hover:bg-yellow-300 rounded transition">
              <i class="fas fa-calendar-day mr-1"></i>今日に戻る
            </button>` : ''}
          </h2>
          <p class="text-blue-100">レッスンがある生徒様: ${dayStudents.length}名</p>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Tutor Filter -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-filter mr-2"></i>
            担当Tutor絞り込み
          </label>
          <select id="tutor-filter-today" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
            <option value="all" ${selectedTutor === 'all' ? 'selected' : ''}>すべてのTutor</option>
            ${getTutorOptions()}
          </select>
        </div>
      </div>

      <!-- Actions -->
      <div class="mt-4 flex gap-2">
        <button onclick="refreshData()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
          <i class="fas fa-sync-alt mr-2"></i>データ更新
        </button>
      </div>
    </div>

    <!-- Today's Students List -->
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-list mr-2"></i>
        本日レッスンの生徒様一覧
      </h2>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">学籍番号</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">生徒名</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">担任Tutor</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">時間</th>
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">キャラ名</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン進捗</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">継続月数</th>
              <th class="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リザルト総合</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">欠席回数</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Meet</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リンク</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン報告</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${renderTodayStudentRows(dayStudents, displayDate)}
          </tbody>
        </table>
      </div>
    </div>
  `;
  
  // Set tutor filter value to current selection
  const selectElement = document.getElementById('tutor-filter-today');
  if (selectElement) {
    selectElement.value = selectedTutor;
    console.log('Set select element value to:', selectedTutor);
    
    // Add event listener for filter changes
    selectElement.addEventListener('change', async (e) => {
      console.log('Filter changed to:', e.target.value);
      await filterByTutor(e.target.value);
    });
  }
}

// Render today's student rows
// Get lesson report button based on submission status
function getLessonReportButton(studentId, lessonDate, studentName, tutorName) {
  const reportKey = `${studentId}-${lessonDate}`;
  const hasReport = lessonReportStatus[reportKey];
  
  // Debug logging
  if (window.debugLessonReport) {
    console.log(`🔍 Button check - studentId: ${studentId}, lessonDate: ${lessonDate}`);
    console.log(`🔍 Report key: ${reportKey}`);
    console.log(`🔍 Has report:`, hasReport);
    console.log(`🔍 All report keys:`, Object.keys(lessonReportStatus));
  }
  
  const escapedName = (studentName || '').replace(/'/g, "\\'");
  const escapedTutor = (tutorName || '').replace(/'/g, "\\'");
  
  if (hasReport) {
    // 提出済み - 青色で表示
    return `
      <button onclick="showLessonReportModal('${studentId}', '${lessonDate}', '${escapedName}', '${escapedTutor}')" 
              class="px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 transition"
              title="提出済み（クリックで編集可能）">
        <i class="fas fa-check-circle mr-1"></i>提出済み
      </button>
    `;
  } else {
    // 未提出 - 緑色で表示
    return `
      <button onclick="showLessonReportModal('${studentId}', '${lessonDate}', '${escapedName}', '${escapedTutor}')" 
              class="px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded hover:bg-green-700 transition">
        <i class="fas fa-clipboard-check mr-1"></i>報告
      </button>
    `;
  }
}

// Check if this is the first lesson of the current month for the student
function isFirstLessonOfMonth(studentId, currentDate) {
  const studentLessonDates = lessonDates[studentId] || [];
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  const currentDay = currentDate.getDate();
  
  // Count lessons in current month up to and including current date
  let lessonCountThisMonth = 0;
  
  for (const lessonInfo of studentLessonDates) {
    const lessonDate = lessonInfo.date;
    const lessonMonth = lessonDate.getMonth() + 1;
    const lessonYear = lessonDate.getFullYear();
    const lessonDay = lessonDate.getDate();
    
    // Same year and month
    if (lessonYear === currentYear && lessonMonth === currentMonth) {
      // Count lessons up to and including current date
      if (lessonDay <= currentDay) {
        lessonCountThisMonth++;
      }
    }
  }
  
  return lessonCountThisMonth === 1;
}

function renderTodayStudentRows(dayStudents, displayDate) {
  if (dayStudents.length === 0) {
    return `
      <tr>
        <td colspan="12" class="px-4 py-8 text-center text-gray-500">
          <i class="fas fa-calendar-times text-4xl mb-2"></i>
          <p>この日のレッスンはありません</p>
        </td>
      </tr>
    `;
  }

  return dayStudents.map(student => {
    // Use pre-fetched Notion URL from cache
    const notionUrl = student.notion_url || 
      (student.notion_page_id ? `https://www.notion.so/${student.notion_page_id.replace(/-/g, '')}` : null);
    
    // Discord URL
    const discordUrl = student.discord_url || null;
    
    // Result overall
    const resultOverall = student.result_overall || '-';
    const resultOverallColor = getResultOverallColor(resultOverall);
    
    // Absence count
    const absenceCount = student.absence_count || 0;
    const absenceColorClass = absenceCount > 3 ? 'text-red-600 font-bold' : absenceCount > 0 ? 'text-orange-600' : 'text-gray-600';
    
    // Lesson start date and continued months
    const suspensionMonths = student.suspension_months || 0;
    const continuedMonths = student.lesson_start_date ? calculateContinuedMonths(student.lesson_start_date, suspensionMonths) : 0;
    
    // Get Meet link and time for display date's lesson
    const studentLessonDates = lessonDates[student.student_id] || [];
    const displayDay = displayDate.getDate();
    const displayMonth = displayDate.getMonth() + 1;
    const dateFormatted = `${displayMonth}/${displayDay}`;
    const dayLesson = studentLessonDates.find(d => d.formatted === dateFormatted);
    const meetLink = dayLesson?.meet_link || null;
    const lessonTime = dayLesson?.time || null;
    
    // Format date for API (YYYY-MM-DD)
    const lessonDateStr = `${displayDate.getFullYear()}-${String(displayMonth).padStart(2, '0')}-${String(displayDay).padStart(2, '0')}`;
    
    // Check if this is the first lesson of the month
    const isFirstLesson = isFirstLessonOfMonth(student.student_id, displayDate);
    
    return `
      <tr class="hover:bg-gray-50 ${isFirstLesson ? 'bg-yellow-50' : ''}">
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${student.student_id || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
          <div class="flex items-center gap-2">
            <span>${student.name || '-'}</span>
            ${isFirstLesson ? `
              <span class="inline-flex items-center px-2 py-1 text-xs font-bold rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 text-white shadow-lg animate-pulse">
                <i class="fas fa-star mr-1"></i>本日リザルトお伝え
              </span>
            ` : ''}
          </div>
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${getTutorDisplayName(student.homeroom_tutor)}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold text-green-600">${lessonTime || '-'}</td>
        <td class="px-3 py-3 text-sm text-gray-600" style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${student.character_name || '-'}">${student.character_name || '-'}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold ${getLessonProgressClass(student.lesson_progress)}">${getLessonProgressDisplay(student.lesson_progress)}</td>
        <td class="px-2 py-3 whitespace-nowrap text-sm text-center font-semibold text-blue-600">${continuedMonths}ヶ月</td>
        <td class="px-2 py-3 whitespace-nowrap text-sm text-center font-semibold ${resultOverallColor}">${resultOverall}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold ${absenceColorClass}">${absenceCount}回</td>
        <td class="px-3 py-3 whitespace-nowrap text-center">
          ${meetLink ? `<a href="${meetLink}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 transition" title="Google Meetを開く"><i class="fas fa-video mr-1"></i>Meet</a>` : '<span class="text-gray-400 text-xs">-</span>'}
        </td>
        <td class="px-3 py-3 whitespace-nowrap text-center">
          <div class="flex gap-2 justify-center">
            ${notionUrl ? `<a href="${notionUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-blue-600 transition" title="Notionページを開く"><i class="fas fa-file-alt text-lg"></i></a>` : '<span class="text-gray-300"><i class="fas fa-file-alt text-lg"></i></span>'}
            ${discordUrl ? `<a href="${discordUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-indigo-600 transition" title="Discordを開く"><i class="fab fa-discord text-lg"></i></a>` : '<span class="text-gray-300"><i class="fab fa-discord text-lg"></i></span>'}
            ${student.youtube_channel_id ? `<a href="${formatYouTubeUrl(student.youtube_channel_id)}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-red-600 transition" title="YouTubeチャンネルを開く"><i class="fab fa-youtube text-lg"></i></a>` : '<span class="text-gray-300"><i class="fab fa-youtube text-lg"></i></span>'}
            ${student.x_account_id ? `<a href="${formatXUrl(student.x_account_id)}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-black transition" title="X (Twitter)アカウントを開く"><i class="fab fa-twitter text-lg"></i></a>` : '<span class="text-gray-300"><i class="fab fa-twitter text-lg"></i></span>'}
            ${student.student_id ? `<a href="https://vtuber-school-evaluation.onrender.com/evaluation-detail?studentId=${student.student_id}&month=${getPreviousMonth()}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-orange-600 transition" title="リザルトシステムを開く"><i class="fas fa-chart-bar text-lg"></i></a>` : '<span class="text-gray-300"><i class="fas fa-chart-bar text-lg"></i></span>'}
          </div>
        </td>
        <td class="px-3 py-3 whitespace-nowrap text-center">
          ${getLessonReportButton(student.student_id, lessonDateStr, student.name, student.homeroom_tutor)}
        </td>
      </tr>
    `;
  }).join('');
}

// ===== Column Filter and Sort Functions =====

let currentFilterColumn = null;

// Toggle sort for a column
function toggleSort(column) {
  if (sortColumn === column) {
    // Toggle direction
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    // Set new column
    sortColumn = column;
    sortDirection = 'asc';
  }
  renderApp();
}

// Toggle filter modal for a column
function toggleFilter(column) {
  currentFilterColumn = column;
  const modal = document.getElementById('filter-modal');
  const title = document.getElementById('filter-modal-title');
  const content = document.getElementById('filter-modal-content');
  
  // Get column display name
  const columnNames = {
    'student_id': '学籍番号',
    'name': '生徒名',
    'status': 'ステータス',
    'contract_plan': '契約プラン',
    'character_name': 'キャラ名',
    'homeroom_tutor': '担任Tutor',
    'result_overall': 'リザルト総合'
  };
  
  title.textContent = `${columnNames[column] || column}でフィルター`;
  
  // Temporarily remove this column's filter to get all available values
  const savedFilter = columnFilters[column];
  delete columnFilters[column];
  
  // Get unique values for this column
  const filtered = getFilteredStudents();
  const uniqueValues = [...new Set(filtered.map(s => {
    let value = s[column];
    // Convert homeroom_tutor to display name
    if (column === 'homeroom_tutor') {
      value = getTutorDisplayName(value);
    }
    return value;
  }).filter(v => v))].sort();
  
  // Restore the filter
  if (savedFilter) {
    columnFilters[column] = savedFilter;
  }
  
  // Generate filter options
  const currentFilter = columnFilters[column];
  content.innerHTML = `
    <!-- Search input -->
    <div class="mb-3">
      <input 
        type="text" 
        id="filter-search-input" 
        placeholder="検索または入力..." 
        value="${currentFilter && currentFilter !== 'all' ? currentFilter : ''}"
        class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        oninput="filterOptions()"
      >
    </div>
    
    <!-- Filter options -->
    <div id="filter-options-list" class="space-y-2 max-h-72 overflow-y-auto border-t pt-2">
      <label class="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
        <input type="radio" name="filter-value" value="all" ${!currentFilter || currentFilter === 'all' ? 'checked' : ''} class="text-blue-600" onchange="updateSearchInput('')">
        <span class="text-sm text-gray-700">すべて表示</span>
      </label>
      ${uniqueValues.map(value => `
        <label class="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer" data-filter-option="${value}">
          <input type="radio" name="filter-value" value="${value}" ${currentFilter === value ? 'checked' : ''} class="text-blue-600" onchange="updateSearchInput('${value.replace(/'/g, "\\'")}')">
          <span class="text-sm text-gray-700">${value}</span>
        </label>
      `).join('')}
    </div>
  `;
  
  modal.classList.remove('hidden');
  
  // Focus on search input
  setTimeout(() => {
    document.getElementById('filter-search-input')?.focus();
  }, 100);
}

// Close filter modal
function closeFilterModal() {
  const modal = document.getElementById('filter-modal');
  modal.classList.add('hidden');
  currentFilterColumn = null;
}

// Apply filter
function applyFilter() {
  // Get value from search input or selected radio
  const searchInput = document.getElementById('filter-search-input')?.value.trim();
  const selectedValue = document.querySelector('input[name="filter-value"]:checked')?.value;
  
  // Prefer search input if it has a value, otherwise use selected radio
  const filterValue = searchInput || selectedValue;
  
  if (currentFilterColumn && filterValue) {
    if (filterValue === 'all' || filterValue === '') {
      delete columnFilters[currentFilterColumn];
    } else {
      // Convert display name back to notion_name for homeroom_tutor
      if (currentFilterColumn === 'homeroom_tutor') {
        const tutor = tutors.find(t => getTutorDisplayName(t.notion_name) === filterValue);
        columnFilters[currentFilterColumn] = tutor ? tutor.notion_name : filterValue;
      } else {
        columnFilters[currentFilterColumn] = filterValue;
      }
    }
  }
  
  closeFilterModal();
  renderApp();
}

// Clear filter for current column
function clearFilter() {
  if (currentFilterColumn) {
    delete columnFilters[currentFilterColumn];
  }
  closeFilterModal();
  renderApp();
}

// Clear all filters and sort
function clearAllFilters() {
  columnFilters = {};
  sortColumn = null;
  sortDirection = 'asc';
  renderApp();
}

// Filter options based on search input
function filterOptions() {
  const searchInput = document.getElementById('filter-search-input');
  const searchValue = searchInput?.value.toLowerCase().trim() || '';
  const optionsList = document.querySelectorAll('[data-filter-option]');
  
  optionsList.forEach(option => {
    const optionText = option.getAttribute('data-filter-option').toLowerCase();
    if (optionText.includes(searchValue)) {
      option.style.display = '';
    } else {
      option.style.display = 'none';
    }
  });
}

// Update search input when radio is selected
function updateSearchInput(value) {
  const searchInput = document.getElementById('filter-search-input');
  if (searchInput) {
    searchInput.value = value;
  }
}

// Calculate tutor's lesson progress status
function getTutorLessonProgressStatus(tutorNotionName) {
  // Get active students for this tutor (excluding 永久会員 and 在籍プラン)
  const activeStudents = students.filter(s => 
    s.homeroom_tutor === tutorNotionName &&
    s.status === 'アクティブ' &&
    s.contract_plan !== '永久会員' &&
    s.contract_plan !== '在籍プラン'
  );
  
  if (activeStudents.length === 0) {
    return { color: 'bg-gray-200', count: 0, slow: 0, verySlow: 0 };
  }
  
  // Count students by progress status
  let normalCount = 0;
  let slowCount = 0;
  let verySlowCount = 0;
  
  activeStudents.forEach(student => {
    const lessonProgress = student.lesson_progress || 0;
    const suspensionMonths = student.suspension_months || 0;
    const continuedMonths = student.lesson_start_date 
      ? calculateContinuedMonths(student.lesson_start_date, suspensionMonths)
      : 0;
    
    if (continuedMonths > 0 && lessonProgress > 0) {
      const expectedProgress = continuedMonths * 2;
      const progressRate = lessonProgress / expectedProgress;
      
      if (progressRate >= 0.7) {
        normalCount++;
      } else if (progressRate >= 0.4) {
        slowCount++;
      } else {
        verySlowCount++;
      }
    }
  });
  
  const totalCount = activeStudents.length;
  const slowRate = (slowCount / totalCount) * 100;
  const verySlowRate = (verySlowCount / totalCount) * 100;
  const combinedRate = ((slowCount + verySlowCount) / totalCount) * 100;
  
  // Determine color based on criteria
  let color = 'bg-blue-500'; // Default: blue
  
  // Red criteria
  if (
    slowRate >= 70 ||
    verySlowRate >= 50 ||
    combinedRate >= 80
  ) {
    color = 'bg-red-500';
  }
  // Yellow criteria
  else if (
    slowRate >= 50 ||
    verySlowRate >= 20 ||
    combinedRate >= 50
  ) {
    color = 'bg-yellow-500';
  }
  
  return {
    color: color,
    count: totalCount,
    normal: normalCount,
    slow: slowCount,
    verySlow: verySlowCount,
    slowRate: slowRate.toFixed(1),
    verySlowRate: verySlowRate.toFixed(1),
    combinedRate: combinedRate.toFixed(1)
  };
}

// ==================== Helper Tutor Request Feature ====================

// Global variables for helper request
let helperRequestData = {
  selectedDate: null,
  selectedLesson: null,
  reason: '',
  notes: '',
  deadline: null
};

// Open helper request modal - Step 1: Date selection
function openHelperRequestModal() {
  const modal = document.createElement('div');
  modal.id = 'helper-request-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-8">
      <div class="flex justify-between items-center p-6 border-b">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-hand-paper mr-2 text-orange-600"></i>助っ人Tutor依頼
        </h2>
        <button onclick="closeHelperRequestModal()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times text-2xl"></i>
        </button>
      </div>
      <div class="p-6">
        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-2">
            レッスン日を選択してください
          </label>
          <input type="date" id="helper-date-input" 
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            onchange="loadLessonsForDate()">
        </div>
        <div id="lessons-list-container" class="hidden">
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">
              生徒名で検索
            </label>
            <input type="text" id="lesson-search-input" 
              placeholder="生徒名を入力..."
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              oninput="filterLessons()">
          </div>
          <div class="mb-4">
            <h3 class="text-lg font-semibold text-gray-800 mb-3">レッスン一覧</h3>
            <div id="lessons-list" class="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
              <!-- Lessons will be loaded here -->
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Close helper request modal
function closeHelperRequestModal() {
  const modal = document.getElementById('helper-request-modal');
  if (modal) {
    modal.remove();
  }
  // Reset data
  helperRequestData = {
    selectedDate: null,
    selectedLesson: null,
    reason: '',
    notes: '',
    deadline: null
  };
}

// Load lessons for selected date
async function loadLessonsForDate() {
  const dateInput = document.getElementById('helper-date-input');
  const selectedDate = dateInput.value;
  
  if (!selectedDate) return;
  
  helperRequestData.selectedDate = selectedDate;
  
  // Show lessons list container
  const container = document.getElementById('lessons-list-container');
  container.classList.remove('hidden');
  
  // Extract year and month from selected date
  const [year, month, day] = selectedDate.split('-');
  
  // Load lesson dates for the selected month if not already loaded
  try {
    console.log(`Loading lesson dates for ${year}/${month}`);
    const res = await axios.get(`${API_BASE}/api/lessons/month/${year}/${parseInt(month)}`);
    
    console.log(`API Response: ${res.data.data.length} lessons found`);
    
    // Debug: Show first 3 lessons
    if (res.data.data.length > 0) {
      res.data.data.slice(0, 3).forEach(lesson => {
        const dateStr = lesson.lesson_date.split('T')[0];
        console.log(`Sample lesson - Student: ${lesson.student_id}, Date: ${dateStr}`);
      });
    }
    
    // Update lessonDates with the selected month's data
    res.data.data.forEach(lesson => {
      if (!lessonDates[lesson.student_id]) {
        lessonDates[lesson.student_id] = [];
      }
      
      // Parse UTC date from database
      const dateStr = lesson.lesson_date.split('T')[0];
      const [yearStr, monthStr, dayStr] = dateStr.split('-');
      const formatted = `${parseInt(monthStr)}/${parseInt(dayStr)}`;
      
      // Check if this date is already in lessonDates
      const existsInDates = lessonDates[lesson.student_id].some(d => d.formatted === formatted);
      if (!existsInDates) {
        lessonDates[lesson.student_id].push({
          date: new Date(lesson.lesson_date),
          formatted: formatted
        });
      }
    });
    
    console.log(`Loaded ${res.data.data.length} lessons for ${year}/${month}`);
  } catch (error) {
    console.error('Error loading lesson dates:', error);
  }
  
  // Filter students who have lessons on this date
  const formattedSelectedDate = `${parseInt(month)}/${parseInt(day)}`;
  
  console.log('Selected date:', selectedDate, 'Formatted:', formattedSelectedDate);
  console.log('Total students:', students.length);
  console.log('Students with lesson dates:', Object.keys(lessonDates).length);
  
  // Debug: Show first 3 students with lesson dates
  const studentIdsWithDates = Object.keys(lessonDates).slice(0, 3);
  studentIdsWithDates.forEach(studentId => {
    const dates = lessonDates[studentId].map(d => d.formatted).join(', ');
    console.log(`Sample - Student ${studentId}: [${dates}]`);
  });
  
  const lessonsOnDate = students.filter(student => {
    const lessonDatesArray = lessonDates[student.student_id];
    if (!lessonDatesArray || !Array.isArray(lessonDatesArray)) return false;
    
    // Check if any lesson date matches the selected date
    const hasLesson = lessonDatesArray.some(lessonDate => {
      return lessonDate.formatted === formattedSelectedDate;
    });
    
    if (hasLesson) {
      console.log(`✓ Student ${student.student_id} (${student.name}) has lesson on ${formattedSelectedDate}`);
    }
    
    return hasLesson;
  });
  
  console.log(`Found ${lessonsOnDate.length} students with lessons on ${formattedSelectedDate}`);
  
  // Display lessons
  displayLessonsList(lessonsOnDate);
}

// Display lessons list
function displayLessonsList(lessons) {
  const listContainer = document.getElementById('lessons-list');
  
  if (lessons.length === 0) {
    listContainer.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-info-circle text-3xl mb-2"></i>
        <p>この日のレッスンはありません</p>
      </div>
    `;
    return;
  }
  
  listContainer.innerHTML = lessons.map(student => {
    const notionUrl = cachedNotionUrls[student.student_id] || `https://www.notion.so/${student.page_id?.replace(/-/g, '')}`;
    return `
      <div class="lesson-item p-4 border-b border-gray-200 hover:bg-gray-50 cursor-pointer transition"
        onclick="selectLesson('${student.student_id}')">
        <div class="flex justify-between items-start">
          <div>
            <div class="font-semibold text-gray-800">${student.name}</div>
            <div class="text-sm text-gray-600">学籍番号: ${student.student_id}</div>
            <div class="text-sm text-gray-600">担任Tutor: ${getTutorDisplayName(student.homeroom_tutor)}</div>
            <div class="text-sm text-gray-600">レッスン進捗: ${student.lesson_progress === 'Proプラン' ? 'Proプラン' : (student.lesson_progress ? `${student.lesson_progress}回` : '0回')}</div>
          </div>
          <div class="flex gap-2">
            <a href="${notionUrl}" target="_blank" onclick="event.stopPropagation()" 
              class="text-blue-600 hover:text-blue-800">
              <i class="fas fa-external-link-alt"></i>
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Filter lessons by search input
function filterLessons() {
  const searchInput = document.getElementById('lesson-search-input');
  const searchTerm = searchInput.value.toLowerCase();
  
  // Convert selectedDate (YYYY-MM-DD) to M/D format for comparison
  const [year, month, day] = helperRequestData.selectedDate.split('-');
  const formattedSelectedDate = `${parseInt(month)}/${parseInt(day)}`;
  
  const lessonsOnDate = students.filter(student => {
    const lessonDatesArray = lessonDates[student.student_id];
    if (!lessonDatesArray || !Array.isArray(lessonDatesArray)) return false;
    
    // Check if any lesson date matches the selected date
    const hasDate = lessonDatesArray.some(lessonDate => {
      return lessonDate.formatted === formattedSelectedDate;
    });
    
    const matchesSearch = !searchTerm || student.name.toLowerCase().includes(searchTerm);
    
    return hasDate && matchesSearch;
  });
  
  displayLessonsList(lessonsOnDate);
}

// Select a lesson and proceed to form input
function selectLesson(studentId) {
  const student = students.find(s => s.student_id === studentId);
  if (!student) return;
  
  helperRequestData.selectedLesson = student;
  
  // Show form input modal (time will be manually entered)
  showHelperRequestForm();
}

// Show helper request form (Step 2: Reason, Notes, Deadline)
function showHelperRequestForm() {
  const student = helperRequestData.selectedLesson;
  const notionUrl = cachedNotionUrls[student.student_id] || `https://www.notion.so/${student.page_id?.replace(/-/g, '')}`;
  
  const modal = document.getElementById('helper-request-modal');
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-8">
      <div class="flex justify-between items-center p-6 border-b">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-hand-paper mr-2 text-orange-600"></i>助っ人Tutor依頼 - 詳細入力
        </h2>
        <button onclick="closeHelperRequestModal()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times text-2xl"></i>
        </button>
      </div>
      <div class="p-6">
        <div class="bg-blue-50 p-4 rounded-lg mb-6">
          <h3 class="font-semibold text-gray-800 mb-2">選択されたレッスン</h3>
          <div class="text-sm">
            <p><span class="font-medium">レッスン日:</span> ${helperRequestData.selectedDate}</p>
            <p><span class="font-medium">生徒名:</span> ${student.name}</p>
            <p><span class="font-medium">学籍番号:</span> ${student.student_id}</p>
            <p><span class="font-medium">担任Tutor:</span> ${getTutorDisplayName(student.homeroom_tutor)}</p>
            <p><span class="font-medium">レッスン進捗:</span> ${student.lesson_progress === 'Proプラン' ? 'Proプラン' : (student.lesson_progress ? `${student.lesson_progress}回` : '0回')}</p>
          </div>
        </div>
        
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              レッスン時間 <span class="text-red-500">*</span>
            </label>
            <input type="time" id="helper-lesson-time-input"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              placeholder="例：10:00">
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              依頼理由 <span class="text-red-500">*</span>
            </label>
            <textarea id="helper-reason-input" 
              rows="3"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              placeholder="例：体調不良のため欠席"></textarea>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              備考
            </label>
            <textarea id="helper-notes-input" 
              rows="3"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              placeholder="その他の情報があれば入力してください"></textarea>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              依頼期限 <span class="text-red-500">*</span>
            </label>
            <input type="datetime-local" id="helper-deadline-input"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent">
          </div>
        </div>
        
        <div class="mt-6 flex gap-3 justify-end">
          <button onclick="showHelperRequestConfirmation()" 
            class="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition">
            <i class="fas fa-check mr-2"></i>確認画面へ
          </button>
          <button onclick="closeHelperRequestModal()" 
            class="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition">
            <i class="fas fa-times mr-2"></i>キャンセル
          </button>
        </div>
      </div>
    </div>
  `;
}

// Show confirmation screen (Step 3: Confirmation)
function showHelperRequestConfirmation() {
  const lessonTime = document.getElementById('helper-lesson-time-input').value.trim();
  const reason = document.getElementById('helper-reason-input').value.trim();
  const notes = document.getElementById('helper-notes-input').value.trim();
  const deadline = document.getElementById('helper-deadline-input').value;
  
  // Validation
  if (!lessonTime) {
    alert('レッスン時間を入力してください');
    return;
  }
  
  if (!reason) {
    alert('依頼理由を入力してください');
    return;
  }
  
  if (!deadline) {
    alert('依頼期限を入力してください');
    return;
  }
  
  helperRequestData.lessonTime = lessonTime;
  helperRequestData.reason = reason;
  helperRequestData.notes = notes;
  helperRequestData.deadline = deadline;
  
  // Format lesson time as "17時～"
  const [hours, minutes] = lessonTime.split(':');
  const formattedTime = `${parseInt(hours)}時～`;
  
  const student = helperRequestData.selectedLesson;
  const notionUrl = cachedNotionUrls[student.student_id] || `https://www.notion.so/${student.page_id?.replace(/-/g, '')}`;
  const formattedDeadline = new Date(deadline).toLocaleString('ja-JP');
  
  const modal = document.getElementById('helper-request-modal');
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-8">
      <div class="flex justify-between items-center p-6 border-b">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-hand-paper mr-2 text-orange-600"></i>助っ人Tutor依頼 - 確認
        </h2>
        <button onclick="closeHelperRequestModal()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times text-2xl"></i>
        </button>
      </div>
      <div class="p-6">
        <div class="bg-gray-50 p-6 rounded-lg mb-6 space-y-3">
          <h3 class="font-bold text-lg text-gray-800 mb-4">依頼内容の確認</h3>
          
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="text-sm text-gray-600">レッスン日</p>
              <p class="font-semibold">${helperRequestData.selectedDate}</p>
            </div>
            <div>
              <p class="text-sm text-gray-600">レッスン時間</p>
              <p class="font-semibold">${formattedTime}</p>
            </div>
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="text-sm text-gray-600">生徒名</p>
              <p class="font-semibold">${student.name}</p>
            </div>
            <div>
              <p class="text-sm text-gray-600">学籍番号</p>
              <p class="font-semibold">${student.student_id}</p>
            </div>
          </div>
          
          <div>
            <p class="text-sm text-gray-600">NotionページURL</p>
            <a href="${notionUrl}" target="_blank" class="text-blue-600 hover:underline break-all">
              ${notionUrl}
            </a>
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="text-sm text-gray-600">依頼Tutor</p>
              <p class="font-semibold">${getTutorDisplayName(student.homeroom_tutor)}</p>
            </div>
            <div>
              <p class="text-sm text-gray-600">レッスン進捗</p>
              <p class="font-semibold">${student.lesson_progress === 'Proプラン' ? 'Proプラン' : (student.lesson_progress ? `${student.lesson_progress}回` : '0回')}</p>
            </div>
          </div>
          
          <div>
            <p class="text-sm text-gray-600">依頼理由</p>
            <p class="font-semibold whitespace-pre-wrap">${reason}</p>
          </div>
          
          ${notes ? `
          <div>
            <p class="text-sm text-gray-600">備考</p>
            <p class="font-semibold whitespace-pre-wrap">${notes}</p>
          </div>
          ` : ''}
          
          <div>
            <p class="text-sm text-gray-600">依頼期限</p>
            <p class="font-semibold text-red-600">${formattedDeadline}</p>
          </div>
        </div>
        
        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
          <p class="text-sm text-yellow-800">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            この内容で助っ人Tutor依頼を送信します。よろしいですか？
          </p>
        </div>
        
        <div class="flex gap-3 justify-end">
          <button onclick="submitHelperRequest()" 
            class="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition">
            <i class="fas fa-paper-plane mr-2"></i>依頼を確定する
          </button>
          <button onclick="showHelperRequestForm()" 
            class="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition">
            <i class="fas fa-arrow-left mr-2"></i>戻る
          </button>
        </div>
      </div>
    </div>
  `;
}

// Submit helper request (Step 4: Submit to API)
async function submitHelperRequest() {
  const student = helperRequestData.selectedLesson;
  const notionUrl = cachedNotionUrls[student.student_id] || `https://www.notion.so/${student.page_id?.replace(/-/g, '')}`;
  
  // Find requesting tutor from tutors array
  const requestingTutor = tutors.find(t => t.notion_name === student.homeroom_tutor);
  
  if (!requestingTutor) {
    alert('担任Tutorの情報が見つかりません');
    return;
  }
  
  // Convert deadline to ISO string (treat as JST)
  // datetime-local returns "YYYY-MM-DDTHH:MM" in local timezone (JST)
  // We need to send it as ISO string to preserve the exact time
  const deadlineDate = new Date(helperRequestData.deadline);
  const deadlineISO = deadlineDate.toISOString();
  
  const requestData = {
    lesson_date: helperRequestData.selectedDate,
    lesson_time: helperRequestData.lessonTime,
    student_id: student.student_id,
    student_name: student.name,
    notion_url: notionUrl,
    requesting_tutor_id: requestingTutor.employee_id,
    requesting_tutor_name: requestingTutor.tutor_name,
    lesson_progress: student.lesson_progress || 0,
    reason: helperRequestData.reason,
    notes: helperRequestData.notes || null,
    deadline: deadlineISO
  };
  
  try {
    const response = await fetch(`${API_BASE}/api/helper-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    const result = await response.json();
    
    if (result.success) {
      alert('助っ人Tutor依頼を送信しました！');
      closeHelperRequestModal();
    } else {
      alert('エラーが発生しました: ' + (result.error || '不明なエラー'));
    }
  } catch (error) {
    console.error('助っ人Tutor依頼の送信エラー:', error);
    alert('助っ人Tutor依頼の送信に失敗しました');
  }
}

// ==================== Helper Requests List Page ====================

let helperRequests = [];
let helperStatusFilter = 'all'; // 'all', 'pending', 'accepted', 'rescheduled'

// Render helpers page
async function renderHelpersPage() {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('content').classList.add('hidden');
  
  // Load helper requests
  await loadHelperRequests();
  
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  
  const content = document.getElementById('content');
  
  content.innerHTML = `
    <div class="mb-6">
      <h1 class="text-3xl font-bold text-gray-800">
        <i class="fas fa-hands-helping mr-3 text-orange-600"></i>
        助っ人Tutor待ち一覧
      </h1>
      <p class="text-gray-600 mt-2">助っ人依頼の管理と受諾</p>
    </div>
    
    <!-- Statistics -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-chart-bar mr-2"></i>統計情報
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        ${renderHelperStatistics()}
      </div>
    </div>
    
    <!-- Status Filter Tabs -->
    <div class="bg-white rounded-lg shadow-md p-2 mb-6">
      <div class="flex flex-wrap gap-2">
        <button onclick="filterHelpersByStatus('all')" class="px-6 py-3 rounded-lg font-semibold transition ${helperStatusFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-list mr-2"></i>すべて
        </button>
        <button onclick="filterHelpersByStatus('pending')" class="px-6 py-3 rounded-lg font-semibold transition ${helperStatusFilter === 'pending' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-clock mr-2"></i>待機中
        </button>
        <button onclick="filterHelpersByStatus('accepted')" class="px-6 py-3 rounded-lg font-semibold transition ${helperStatusFilter === 'accepted' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-check-circle mr-2"></i>受諾済み
        </button>
        <button onclick="filterHelpersByStatus('rescheduled')" class="px-6 py-3 rounded-lg font-semibold transition ${helperStatusFilter === 'rescheduled' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-calendar-times mr-2"></i>リスケジュール
        </button>
      </div>
    </div>
    
    <!-- Helper Requests List -->
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-list mr-2"></i>
        ${getHelperStatusTitle()}
      </h2>
      <div id="helper-requests-list">
        ${renderHelperRequestsList()}
      </div>
    </div>
  `;
}

// Load helper requests from API
async function loadHelperRequests() {
  try {
    const res = await axios.get(`${API_BASE}/api/helper-requests`);
    helperRequests = res.data.data || [];
    console.log(`Loaded ${helperRequests.length} helper requests`);
    
    // Update helper badge
    updateHelperBadge();
  } catch (error) {
    console.error('Error loading helper requests:', error);
    helperRequests = [];
    updateHelperBadge();
  }
}

// Update helper requests badge count
function updateHelperBadge() {
  const badge = document.getElementById('helper-badge');
  if (!badge) return;
  
  const pendingCount = helperRequests.filter(r => r.status === 'pending').length;
  
  if (pendingCount > 0) {
    badge.textContent = pendingCount > 9 ? '9+' : pendingCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// Load extension tutor stats from API
async function loadExtensionTutorStats() {
  try {
    const res = await axios.get(`${API_BASE}/api/extensions/by-tutor`);
    extensionTutorStats = res.data.data || [];
    console.log(`Loaded ${extensionTutorStats.length} extension tutor stats`);
    
    // Set selected tutor to current user's tutor name
    if (currentTutorName) {
      selectedExtensionTutor = currentTutorName;
    }
    
    // Update extension badges
    updateExtensionBadges();
  } catch (error) {
    console.error('Error loading extension tutor stats:', error);
    extensionTutorStats = [];
    updateExtensionBadges();
  }
}

// Update extension badges count
function updateExtensionBadges() {
  const hearingBadge = document.getElementById('extension-hearing-badge');
  const examBadge = document.getElementById('extension-exam-badge');
  
  if (!hearingBadge || !examBadge) {
    console.warn('Extension badges not found in DOM');
    return;
  }
  
  // Find stats for selected tutor (or current tutor)
  const tutorName = selectedExtensionTutor || currentTutorName;
  console.log(`Updating extension badges for tutor: ${tutorName}`);
  const tutorStats = extensionTutorStats.find(t => t.tutorName === tutorName);
  
  if (tutorStats) {
    console.log(`Found stats for ${tutorName}:`, tutorStats);
    // Update hearing badge (orange)
    if (tutorStats.hearingIncompleteCount > 0) {
      hearingBadge.textContent = tutorStats.hearingIncompleteCount > 9 ? '9+' : tutorStats.hearingIncompleteCount;
      hearingBadge.classList.remove('hidden');
    } else {
      hearingBadge.classList.add('hidden');
    }
    
    // Update exam badge (red)
    if (tutorStats.examIncompleteCount > 0) {
      examBadge.textContent = tutorStats.examIncompleteCount > 9 ? '9+' : tutorStats.examIncompleteCount;
      examBadge.classList.remove('hidden');
    } else {
      examBadge.classList.add('hidden');
    }
  } else {
    // No stats found, hide badges
    console.log(`No stats found for tutor: ${tutorName}`);
    hearingBadge.classList.add('hidden');
    examBadge.classList.add('hidden');
  }
}

// Render helper statistics
function renderHelperStatistics() {
  const pending = helperRequests.filter(r => r.status === 'pending').length;
  const accepted = helperRequests.filter(r => r.status === 'accepted').length;
  const rescheduled = helperRequests.filter(r => r.status === 'rescheduled').length;
  const total = helperRequests.length;
  
  return `
    <div class="bg-blue-50 p-4 rounded-lg">
      <div class="text-sm text-blue-600 font-semibold">総依頼数</div>
      <div class="text-2xl font-bold text-blue-800 mt-1">${total}件</div>
    </div>
    <div class="bg-orange-50 p-4 rounded-lg">
      <div class="text-sm text-orange-600 font-semibold">待機中</div>
      <div class="text-2xl font-bold text-orange-800 mt-1">${pending}件</div>
    </div>
    <div class="bg-green-50 p-4 rounded-lg">
      <div class="text-sm text-green-600 font-semibold">受諾済み</div>
      <div class="text-2xl font-bold text-green-800 mt-1">${accepted}件</div>
    </div>
    <div class="bg-red-50 p-4 rounded-lg">
      <div class="text-sm text-red-600 font-semibold">リスケジュール</div>
      <div class="text-2xl font-bold text-red-800 mt-1">${rescheduled}件</div>
    </div>
  `;
}

// Get status title
function getHelperStatusTitle() {
  const titles = {
    'all': 'すべての依頼',
    'pending': '待機中の依頼',
    'accepted': '受諾済みの依頼',
    'rescheduled': 'リスケジュールされた依頼'
  };
  return titles[helperStatusFilter] || 'すべての依頼';
}

// Filter helpers by status
async function filterHelpersByStatus(status) {
  helperStatusFilter = status;
  await renderHelpersPage();
}

// Render helper requests list
function renderHelperRequestsList() {
  let filteredRequests = helperRequests;
  
  if (helperStatusFilter !== 'all') {
    filteredRequests = helperRequests.filter(r => r.status === helperStatusFilter);
  }
  
  // Sort by created_at descending
  filteredRequests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  if (filteredRequests.length === 0) {
    return `
      <div class="text-center py-12 text-gray-500">
        <i class="fas fa-inbox text-4xl mb-3"></i>
        <p>該当する依頼はありません</p>
      </div>
    `;
  }
  
  return filteredRequests.map(request => {
    const statusColor = {
      'pending': 'bg-orange-100 text-orange-800',
      'accepted': 'bg-green-100 text-green-800',
      'rescheduled': 'bg-red-100 text-red-800'
    }[request.status] || 'bg-gray-100 text-gray-800';
    
    const statusIcon = {
      'pending': 'fa-clock',
      'accepted': 'fa-check-circle',
      'rescheduled': 'fa-calendar-times'
    }[request.status] || 'fa-question-circle';
    
    const statusText = {
      'pending': '待機中',
      'accepted': '受諾済み',
      'rescheduled': 'リスケジュール'
    }[request.status] || request.status;
    
    const lessonDate = new Date(request.lesson_date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    });
    
    const deadline = new Date(request.deadline);
    const now = new Date();
    const isExpired = deadline < now && request.status === 'pending';
    const deadlineClass = isExpired ? 'text-red-600 font-bold' : 'text-gray-600';
    
    return `
      <div class="border border-gray-200 rounded-lg p-4 mb-4 hover:shadow-md transition">
        <div class="flex justify-between items-start mb-3">
          <div>
            <span class="inline-block px-3 py-1 rounded-full text-sm font-semibold ${statusColor}">
              <i class="fas ${statusIcon} mr-1"></i>${statusText}
            </span>
            ${isExpired ? '<span class="ml-2 inline-block px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-800"><i class="fas fa-exclamation-triangle mr-1"></i>期限切れ</span>' : ''}
          </div>
          <div class="text-sm text-gray-500">
            依頼ID: #${request.id}
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
          <div>
            <div class="text-sm text-gray-600 mb-1">レッスン情報</div>
            <div class="font-semibold text-gray-800">${lessonDate}</div>
            <div class="text-sm text-gray-600">時間: ${request.lesson_time ? (() => {
              const [h, m] = request.lesson_time.split(':');
              return `${parseInt(h)}時～`;
            })() : '未設定'}</div>
          </div>
          <div>
            <div class="text-sm text-gray-600 mb-1">生徒情報</div>
            <div class="font-semibold text-gray-800">${request.student_name}</div>
            <div class="text-sm text-gray-600">学籍番号: ${request.student_id}</div>
            <div class="text-sm text-gray-600">進捗: ${request.lesson_progress}回</div>
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
          <div>
            <div class="text-sm text-gray-600 mb-1">依頼Tutor</div>
            <div class="font-semibold text-gray-800">${request.requesting_tutor_name || '-'}</div>
          </div>
          ${request.status === 'accepted' ? `
          <div>
            <div class="text-sm text-gray-600 mb-1">受諾Tutor</div>
            <div class="font-semibold text-green-700">${request.accepted_by_tutor_name || '-'}</div>
            <div class="text-sm text-gray-500">受諾日時: ${new Date(request.accepted_at).toLocaleString('ja-JP')}</div>
          </div>
          ` : ''}
        </div>
        
        <div class="mb-3">
          <div class="text-sm text-gray-600 mb-1">依頼理由</div>
          <div class="text-gray-800 whitespace-pre-wrap">${request.reason}</div>
        </div>
        
        ${request.notes ? `
        <div class="mb-3">
          <div class="text-sm text-gray-600 mb-1">備考</div>
          <div class="text-gray-800 whitespace-pre-wrap">${request.notes}</div>
        </div>
        ` : ''}
        
        <div class="mb-3">
          <div class="text-sm text-gray-600 mb-1">依頼期限</div>
          <div class="${deadlineClass}">${deadline.toLocaleString('ja-JP')}</div>
        </div>
        
        <div class="flex gap-2 mt-4">
          <a href="${request.notion_url}" target="_blank" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm">
            <i class="fas fa-external-link-alt mr-2"></i>Notionで開く
          </a>
          ${request.status === 'pending' && !isExpired ? `
          <button onclick="acceptHelperRequest(${request.id})" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm">
            <i class="fas fa-check mr-2"></i>この依頼を受諾する
          </button>
          ` : ''}
          ${request.status === 'pending' && isExpired ? `
          <button disabled class="px-4 py-2 bg-gray-400 text-white rounded-lg cursor-not-allowed text-sm">
            <i class="fas fa-times mr-2"></i>期限切れのため受諾不可
          </button>
          ` : ''}
          <button onclick="deleteHelperRequest(${request.id})" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm">
            <i class="fas fa-trash mr-2"></i>削除
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Accept helper request
async function acceptHelperRequest(requestId) {
  // Show tutor selection modal
  showTutorSelectionModal(requestId);
}

// Show tutor selection modal
function showTutorSelectionModal(requestId) {
  const modal = document.createElement('div');
  modal.id = 'tutor-selection-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
      <div class="flex justify-between items-center p-6 border-b">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-user-check mr-2 text-green-600"></i>受諾Tutor選択
        </h2>
        <button onclick="closeTutorSelectionModal()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times text-2xl"></i>
        </button>
      </div>
      <div class="p-6">
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">
            受諾するTutorを選択してください
          </label>
          <select id="accepting-tutor-select" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
            <option value="">Tutorを選択...</option>
            ${tutors.filter(t => t.status === 'アクティブ' && t.job_type && t.job_type.includes('Tutor')).map(t => 
              `<option value="${t.employee_id}">${t.tutor_name}</option>`
            ).join('')}
          </select>
        </div>
        
        <div class="flex gap-3 justify-end">
          <button onclick="confirmAcceptHelperRequest(${requestId})" class="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
            <i class="fas fa-check mr-2"></i>確定する
          </button>
          <button onclick="closeTutorSelectionModal()" class="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition">
            <i class="fas fa-times mr-2"></i>キャンセル
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Close tutor selection modal
function closeTutorSelectionModal() {
  const modal = document.getElementById('tutor-selection-modal');
  if (modal) {
    modal.remove();
  }
}

// Confirm accept helper request
async function confirmAcceptHelperRequest(requestId) {
  const tutorSelect = document.getElementById('accepting-tutor-select');
  const tutorId = tutorSelect.value;
  
  if (!tutorId) {
    alert('Tutorを選択してください');
    return;
  }
  
  const tutor = tutors.find(t => t.employee_id === tutorId);
  if (!tutor) {
    alert('選択されたTutorが見つかりません');
    return;
  }
  
  try {
    const res = await axios.post(`${API_BASE}/api/helper-requests/${requestId}/accept`, {
      tutor_id: tutor.employee_id,
      tutor_name: tutor.tutor_name
    });
    
    if (res.data.success) {
      alert('助っ人依頼を受諾しました！');
      closeTutorSelectionModal();
      await renderHelpersPage();
    } else {
      alert('エラーが発生しました: ' + (res.data.error || '不明なエラー'));
    }
  } catch (error) {
    console.error('助っ人依頼の受諾エラー:', error);
    alert('助っ人依頼の受諾に失敗しました');
  }
}

// Delete helper request
async function deleteHelperRequest(requestId) {
  if (!confirm('この助っ人依頼を削除しますか？\n\nこの操作は取り消せません。')) {
    return;
  }
  
  try {
    const res = await axios.delete(`${API_BASE}/api/helper-requests/${requestId}`);
    
    if (res.data.success) {
      alert('助っ人依頼を削除しました');
      await renderHelpersPage();
    } else {
      alert('エラーが発生しました: ' + (res.data.error || '不明なエラー'));
    }
  } catch (error) {
    console.error('助っ人依頼の削除エラー:', error);
    alert('助っ人依頼の削除に失敗しました');
  }
}

// ========== Tutor Schedules Page ==========

/**
 * Render Tutor Schedules Page
 */
async function renderSchedulesPage() {
  const content = document.getElementById('content');
  
  // Show loading
  content.innerHTML = `
    <div class="text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
      <p class="mt-4 text-gray-600">スケジュールを読み込んでいます...</p>
    </div>
  `;
  
  try {
    // Fetch schedules from API
    const res = await axios.get(`${API_BASE}/api/schedules`);
    
    if (res.data.success) {
      schedules = res.data.data;
      
      // Fetch absence requests for current month
      try {
        const absenceRes = await axios.get(`${API_BASE}/api/schedules/absence-requests?year=${selectedScheduleYear}&month=${selectedScheduleMonth}`);
        if (absenceRes.data.success) {
          const absenceRequests = absenceRes.data.data.requests;
          
          // Add absence information to schedules
          schedules = schedules.map(schedule => {
            const uniqueKey = schedule.unique_event_key || schedule.event_id;
            const eventAbsences = absenceRequests[uniqueKey] || [];
            return {
              ...schedule,
              absence_requests: eventAbsences
            };
          });
        }
      } catch (absenceError) {
        console.error('Error fetching absence requests:', absenceError);
        // Continue without absence data
      }
      
      renderSchedulesContent();
    } else {
      content.innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <i class="fas fa-exclamation-circle text-red-600 text-4xl mb-4"></i>
          <p class="text-red-800 font-semibold">スケジュールの取得に失敗しました</p>
          <p class="text-red-600 mt-2">${res.data.error || '不明なエラー'}</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('スケジュール取得エラー:', error);
    content.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <i class="fas fa-exclamation-circle text-red-600 text-4xl mb-4"></i>
        <p class="text-red-800 font-semibold">スケジュールの取得に失敗しました</p>
        <p class="text-red-600 mt-2">${error.message}</p>
      </div>
    `;
  }
}

/**
 * Render Schedules Content
 */
function renderSchedulesContent() {
  const content = document.getElementById('content');
  
  content.innerHTML = `
    <!-- Controls -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <div class="flex flex-col gap-4">
        <!-- Top row: Month navigation -->
        <div class="flex items-center justify-between">
          <button onclick="changeScheduleMonth(-1)" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition">
            <i class="fas fa-chevron-left mr-2"></i>前月
          </button>
          <h2 class="text-2xl font-bold text-gray-800">
            ${selectedScheduleYear}年${selectedScheduleMonth}月
          </h2>
          <button onclick="changeScheduleMonth(1)" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition">
            来月<i class="fas fa-chevron-right ml-2"></i>
          </button>
        </div>
        
        <!-- Tabs: 受理済み / 申請中 (only for leader+ roles) -->
        ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'leader') ? `
          <div class="flex gap-2 border-b border-gray-200">
            <button 
              onclick="handleScheduleTabChange('confirmed')" 
              class="px-6 py-3 font-semibold transition ${scheduleTab === 'confirmed' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-blue-500'}">
              受理済み
            </button>
            <button 
              onclick="handleScheduleTabChange('pending')" 
              class="px-6 py-3 font-semibold transition ${scheduleTab === 'pending' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-blue-500'}">
              申請中
            </button>
          </div>
        ` : ''}
        
        <!-- Second row: Filters (hide for pending tab) -->
        ${scheduleTab === 'confirmed' ? `
        <div class="grid grid-cols-2 md:grid-cols-5 gap-2">`
: '<!-- Filters hidden for pending tab --><div style="display:none;">'}
          <!-- Keyword filter -->
          <select id="keyword-filter" onchange="handleKeywordFilterChange(this.value)" class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            <option value="all">すべてのキーワード</option>
            <option value="ロープレ">ロープレ</option>
            <option value="1on1">1on1</option>
            <option value="チームMTG">チームMTG</option>
            <option value="チーム研修">チーム研修</option>
            <option value="全Tutor MTG">全Tutor MTG</option>
          </select>
          
          <!-- Date range filter -->
          <select id="date-range-filter" onchange="handleDateRangeFilterChange(this.value)" class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            <option value="all">すべての日付</option>
            <option value="this_week">今週</option>
            <option value="next_week">来週</option>
            <option value="this_month">今月</option>
            <option value="next_month">来月</option>
          </select>
          
          <!-- Leader filter -->
          <select id="leader-filter" onchange="handleLeaderFilterChange(this.value)" class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            ${renderLeaderFilterOptions()}
          </select>
          
          <!-- Attendee filter -->
          <select id="attendee-filter" onchange="handleAttendeeFilterChange(this.value)" class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            ${renderAttendeeFilterOptions()}
          </select>
          
          <!-- View mode toggle -->
          <div class="flex gap-2">
            <button onclick="toggleScheduleViewMode('list')" class="flex-1 px-3 py-2 ${scheduleViewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} rounded-lg hover:opacity-80 transition">
              <i class="fas fa-list mr-1"></i>リスト
            </button>
            <button onclick="toggleScheduleViewMode('calendar')" class="flex-1 px-3 py-2 ${scheduleViewMode === 'calendar' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} rounded-lg hover:opacity-80 transition">
              <i class="fas fa-calendar mr-1"></i>カレンダー
            </button>
          </div>
        </div>
        
        <!-- Third row: Actions (hide for pending tab) -->
        ${scheduleTab === 'confirmed' ? `
        <div class="flex gap-2">
          <button onclick="renderSchedulesPage()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
            <i class="fas fa-sync-alt mr-2"></i>データ更新
          </button>
          <button onclick="clearScheduleFilters()" class="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition">
            <i class="fas fa-times mr-2"></i>フィルタークリア
          </button>
        </div>
        ` : ''}
      </div>
    </div>

    ${scheduleTab === 'confirmed' ? `
    <!-- Statistics -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-chart-bar mr-2"></i>統計情報
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        ${renderScheduleStatistics()}
      </div>
    </div>

    <!-- Schedules List or Calendar -->
    <div class="bg-white rounded-lg shadow-md p-6">
      ${scheduleViewMode === 'list' ? renderSchedulesList() : renderSchedulesCalendar()}
    </div>
    ` : `
    <!-- Pending Absence Requests -->
    <div class="bg-white rounded-lg shadow-md p-6">
      ${renderPendingRequests()}
    </div>
    `}
    
    ${scheduleTab === 'confirmed' ? `
    <!-- Attendance Statistics -->
    <div class="bg-white rounded-lg shadow-md p-6 mt-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-user-check mr-2"></i>参加者別出席回数統計
      </h2>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tutor名</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ロープレ</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">1on1</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">チームMTG</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">チーム研修</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">全Tutor MTG</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">合計</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${renderAttendanceStatistics()}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}
  `;
}

/**
 * Render schedule statistics
 */
function renderScheduleStatistics() {
  // Get filtered schedules
  const filteredSchedules = getFilteredSchedules();
  const total = filteredSchedules.length;
  
  // Count by keyword
  const keywords = {};
  filteredSchedules.forEach(schedule => {
    const keyword = schedule.matched_keyword || '不明';
    keywords[keyword] = (keywords[keyword] || 0) + 1;
  });
  
  // Sort by count
  const sortedKeywords = Object.entries(keywords).sort((a, b) => b[1] - a[1]);
  
  // Total stats
  let statsHtml = `
    <div class="bg-blue-50 p-4 rounded-lg">
      <div class="text-sm text-gray-600 mb-1">総スケジュール数</div>
      <div class="text-3xl font-bold text-blue-600">${total}件</div>
    </div>
  `;
  
  // Keyword stats (top 3)
  sortedKeywords.slice(0, 3).forEach(([keyword, count], index) => {
    const colors = [
      { bg: 'bg-green-50', text: 'text-green-600' },
      { bg: 'bg-orange-50', text: 'text-orange-600' },
      { bg: 'bg-purple-50', text: 'text-purple-600' }
    ];
    const color = colors[index] || colors[0];
    
    statsHtml += `
      <div class="${color.bg} p-4 rounded-lg">
        <div class="text-sm text-gray-600 mb-1">${keyword}</div>
        <div class="text-3xl font-bold ${color.text}">${count}件</div>
      </div>
    `;
  });
  
  return statsHtml;
}

// ==================== Schedule Filter & Navigation Functions ====================

/**
 * Change schedule month
 */
async function changeScheduleMonth(offset) {
  selectedScheduleMonth += offset;
  if (selectedScheduleMonth > 12) {
    selectedScheduleMonth = 1;
    selectedScheduleYear++;
  } else if (selectedScheduleMonth < 1) {
    selectedScheduleMonth = 12;
    selectedScheduleYear--;
  }
  
  // Reload data based on current tab
  if (scheduleTab === 'pending') {
    await handleScheduleTabChange('pending');
  } else {
    // Reload schedules with new absence data for the selected month
    await renderSchedulesPage();
  }
}

/**
 * Handle keyword filter change
 */
function handleKeywordFilterChange(value) {
  selectedKeyword = value;
  renderSchedulesContent();
}

/**
 * Handle schedule tab change
 */
async function handleScheduleTabChange(tab) {
  scheduleTab = tab;
  
  // Show loading
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
      <p class="mt-4 text-gray-600">読み込み中...</p>
    </div>
  `;
  
  if (tab === 'pending') {
    // Fetch pending requests
    try {
      const res = await axios.get(`${API_BASE}/api/schedules/absence-requests/pending?year=${selectedScheduleYear}&month=${selectedScheduleMonth}`);
      if (res.data.success) {
        pendingRequests = res.data.data.pendingRequests;
      }
    } catch (error) {
      console.error('Error fetching pending requests:', error);
      pendingRequests = [];
    }
  }
  
  renderSchedulesContent();
}

/**
 * Handle date range filter change
 */
function handleDateRangeFilterChange(value) {
  selectedDateRange = value;
  renderSchedulesContent();
}

/**
 * Handle leader filter change
 */
function handleLeaderFilterChange(value) {
  selectedLeader = value;
  renderSchedulesContent();
}

/**
 * Handle attendee filter change
 */
function handleAttendeeFilterChange(value) {
  selectedAttendee = value;
  renderSchedulesContent();
}

/**
 * Toggle schedule view mode
 */
function toggleScheduleViewMode(mode) {
  scheduleViewMode = mode;
  renderSchedulesContent();
}

/**
 * Clear all schedule filters
 */
function clearScheduleFilters() {
  selectedKeyword = 'all';
  selectedDateRange = 'all';
  selectedLeader = 'all';
  selectedAttendee = 'all';
  renderSchedulesContent();
}

/**
 * Render leader filter options
 */
function renderLeaderFilterOptions() {
  // Get unique leaders from schedules
  const leaders = [...new Set(schedules.map(s => s.leader_name).filter(Boolean))];
  leaders.sort();
  
  let html = `<option value="all" ${selectedLeader === 'all' ? 'selected' : ''}>すべてのリーダー</option>`;
  leaders.forEach(leader => {
    const isSelected = leader === selectedLeader ? 'selected' : '';
    html += `<option value="${leader}" ${isSelected}>${leader}</option>`;
  });
  
  return html;
}

/**
 * Render attendee filter options
 */
function renderAttendeeFilterOptions() {
  // Get unique attendees from all schedules
  const attendeesSet = new Set();
  schedules.forEach(schedule => {
    if (schedule.attendee_names && Array.isArray(schedule.attendee_names)) {
      schedule.attendee_names.forEach(name => {
        if (name) attendeesSet.add(name);
      });
    }
  });
  
  const attendees = [...attendeesSet].sort();
  
  let html = `<option value="all" ${selectedAttendee === 'all' ? 'selected' : ''}>すべての参加者</option>`;
  attendees.forEach(attendee => {
    const isSelected = attendee === selectedAttendee ? 'selected' : '';
    html += `<option value="${attendee}" ${isSelected}>${attendee}</option>`;
  });
  
  return html;
}

/**
 * Get filtered schedules based on current filters
 */
function getFilteredSchedules() {
  return schedules.filter(schedule => {
    // Month filter (always applied)
    const scheduleDate = new Date(schedule.start_time);
    const scheduleYear = scheduleDate.getFullYear();
    const scheduleMonth = scheduleDate.getMonth() + 1;
    
    if (scheduleYear !== selectedScheduleYear || scheduleMonth !== selectedScheduleMonth) {
      return false;
    }
    
    // Keyword filter
    if (selectedKeyword !== 'all' && schedule.matched_keyword !== selectedKeyword) {
      return false;
    }
    
    // Date range filter
    if (selectedDateRange !== 'all') {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const scheduleDay = new Date(scheduleYear, scheduleMonth - 1, scheduleDate.getDate());
      
      const dayOfWeek = today.getDay();
      const thisWeekStart = new Date(today);
      thisWeekStart.setDate(today.getDate() - dayOfWeek);
      const thisWeekEnd = new Date(thisWeekStart);
      thisWeekEnd.setDate(thisWeekStart.getDate() + 6);
      
      const nextWeekStart = new Date(thisWeekStart);
      nextWeekStart.setDate(thisWeekStart.getDate() + 7);
      const nextWeekEnd = new Date(nextWeekStart);
      nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
      
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      
      switch(selectedDateRange) {
        case 'this_week':
          if (scheduleDay < thisWeekStart || scheduleDay > thisWeekEnd) return false;
          break;
        case 'next_week':
          if (scheduleDay < nextWeekStart || scheduleDay > nextWeekEnd) return false;
          break;
        case 'this_month':
          if (scheduleDay < thisMonthStart || scheduleDay > thisMonthEnd) return false;
          break;
        case 'next_month':
          if (scheduleDay < nextMonthStart || scheduleDay > nextMonthEnd) return false;
          break;
      }
    }
    
    // Leader filter
    if (selectedLeader !== 'all') {
      // If leader filter is set, show schedules where user is leader OR attendee
      const attendees = schedule.attendee_names || [];
      const isLeader = schedule.leader_name === selectedLeader;
      const isAttendee = attendees.includes(selectedLeader);
      
      if (!isLeader && !isAttendee) {
        return false;
      }
    }
    
    // Attendee filter (independent from leader filter)
    if (selectedAttendee !== 'all' && selectedAttendee !== selectedLeader) {
      const attendees = schedule.attendee_names || [];
      if (!attendees.includes(selectedAttendee)) {
        return false;
      }
    }
    
    return true;
  });
}

/**
 * Render schedules list view
 */
function renderSchedulesList() {
  const filteredSchedules = getFilteredSchedules();
  
  if (filteredSchedules.length === 0) {
    return `
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-calendar-check mr-2"></i>スケジュール一覧
      </h2>
      <div class="text-center py-8">
        <i class="fas fa-inbox text-4xl text-gray-400 mb-2"></i>
        <p class="text-gray-500">表示するスケジュールがありません</p>
      </div>
    `;
  }
  
  // Sort by date (ascending)
  const sortedSchedules = [...filteredSchedules].sort((a, b) => {
    if (!a.start_time) return 1;
    if (!b.start_time) return -1;
    return new Date(a.start_time) - new Date(b.start_time);
  });
  
  return `
    <h2 class="text-xl font-bold text-gray-800 mb-4">
      <i class="fas fa-calendar-check mr-2"></i>スケジュール一覧 (${filteredSchedules.length}件)
    </h2>
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">キーワード</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">リーダー名</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">スケジュール名</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日付</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">時間</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">参加者</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">不参加申請済み</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">アクション</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          ${sortedSchedules.map(schedule => {
            const keyword = schedule.matched_keyword || '-';
            const leaderName = schedule.leader_name || '-';
            const title = schedule.title || '-';
            const scheduleDate = schedule.schedule_date || '-';
            const scheduleTime = schedule.schedule_time || '-';
            const attendeeNames = schedule.attendee_names && schedule.attendee_names.length > 0
              ? schedule.attendee_names.join(', ')
              : '-';
            
            // Get absence requests for this schedule
            const absenceRequests = schedule.absence_requests || [];
            
            // Remove duplicates: keep only the latest request per tutor
            const uniqueAbsenceRequests = [];
            const seenTutors = new Set();
            
            // Sort by created_at descending (latest first)
            const sortedAbsences = [...absenceRequests].sort((a, b) => 
              new Date(b.created_at) - new Date(a.created_at)
            );
            
            sortedAbsences.forEach(req => {
              if (!seenTutors.has(req.tutor_email)) {
                uniqueAbsenceRequests.push(req);
                seenTutors.add(req.tutor_email);
              }
            });
            
            const absenceNames = uniqueAbsenceRequests.length > 0
              ? uniqueAbsenceRequests.map(req => {
                  const typeLabel = req.absence_type === 'cancel' ? 'キャンセル' : 'リスケ';
                  const typeColor = req.absence_type === 'cancel' ? 'text-red-600' : 'text-orange-600';
                  
                  // Add cancel button if this is current user's request
                  const isOwnRequest = currentTutorEmail && req.tutor_email === currentTutorEmail;
                  const uniqueKey = schedule.unique_event_key || schedule.event_id;
                  const cancelButton = isOwnRequest 
                    ? `<button onclick="cancelAbsenceRequest('${uniqueKey}', '${req.tutor_email}')" class="ml-2 text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded" title="取り下げる">
                         <i class="fas fa-times"></i>
                       </button>`
                    : '';
                  
                  return `<span class="${typeColor} font-semibold">${req.tutor_name} (${typeLabel})${cancelButton}</span>`;
                }).join(', ')
              : '<span class="text-gray-400">-</span>';
            
            // Keyword badge colors
            const keywordColors = {
              'ロープレ': 'bg-blue-100 text-blue-800',
              '1on1': 'bg-green-100 text-green-800',
              'チームMTG': 'bg-orange-100 text-orange-800',
              'チーム研修': 'bg-purple-100 text-purple-800',
              '全Tutor MTG': 'bg-pink-100 text-pink-800'
            };
            const colorClass = keywordColors[keyword] || 'bg-gray-100 text-gray-800';
            
            // Convert schedule object to JSON string for onclick (escape quotes)
            const scheduleJson = JSON.stringify(schedule).replace(/"/g, '&quot;');
            
            return `
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 whitespace-nowrap">
                  <span class="px-2 py-1 text-xs font-semibold rounded-full ${colorClass}">
                    ${keyword}
                  </span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">${leaderName}</td>
                <td class="px-4 py-3 text-sm text-gray-900">${title}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${scheduleDate}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${scheduleTime}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${attendeeNames}</td>
                <td class="px-4 py-3 text-sm">${absenceNames}</td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <button 
                    onclick='openAbsenceRequestModal(${scheduleJson})' 
                    class="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition"
                  >
                    <i class="fas fa-calendar-times mr-1"></i>不参加申請
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Render schedules calendar view
 */
function renderSchedulesCalendar() {
  const filteredSchedules = getFilteredSchedules();
  
  // Get days in selected month
  const firstDay = new Date(selectedScheduleYear, selectedScheduleMonth - 1, 1);
  const lastDay = new Date(selectedScheduleYear, selectedScheduleMonth, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();
  
  // Create calendar grid
  const calendar = [];
  for (let i = 0; i < daysInMonth; i++) {
    calendar.push({
      day: i + 1,
      schedules: filteredSchedules.filter(s => {
        const scheduleDate = new Date(s.start_time);
        return scheduleDate.getDate() === (i + 1);
      })
    });
  }
  
  return `
    <h2 class="text-xl font-bold text-gray-800 mb-4">
      <i class="fas fa-calendar-alt mr-2"></i>カレンダー表示
    </h2>
    <div class="grid grid-cols-7 gap-2">
      <!-- Day headers -->
      <div class="text-center font-semibold text-sm text-red-600 p-2">日</div>
      <div class="text-center font-semibold text-sm text-gray-700 p-2">月</div>
      <div class="text-center font-semibold text-sm text-gray-700 p-2">火</div>
      <div class="text-center font-semibold text-sm text-gray-700 p-2">水</div>
      <div class="text-center font-semibold text-sm text-gray-700 p-2">木</div>
      <div class="text-center font-semibold text-sm text-gray-700 p-2">金</div>
      <div class="text-center font-semibold text-sm text-blue-600 p-2">土</div>
      
      <!-- Empty cells before first day -->
      ${Array(startDayOfWeek).fill(0).map(() => '<div class="border border-gray-200 bg-gray-50 min-h-24"></div>').join('')}
      
      <!-- Calendar days -->
      ${calendar.map(dayData => {
        const dayOfWeek = (startDayOfWeek + dayData.day - 1) % 7;
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const bgColor = isWeekend ? 'bg-blue-50' : 'bg-white';
        
        return `
          <div class="border border-gray-300 ${bgColor} min-h-24 p-2">
            <div class="text-sm font-semibold mb-1 ${dayOfWeek === 0 ? 'text-red-600' : dayOfWeek === 6 ? 'text-blue-600' : 'text-gray-700'}">
              ${dayData.day}
            </div>
            <div class="space-y-1">
              ${dayData.schedules.map(schedule => {
                const keyword = schedule.matched_keyword || '';
                const time = schedule.schedule_time || '';
                const keywordColors = {
                  'ロープレ': 'bg-blue-200 border-blue-400',
                  '1on1': 'bg-green-200 border-green-400',
                  'チームMTG': 'bg-orange-200 border-orange-400',
                  'チーム研修': 'bg-purple-200 border-purple-400',
                  '全Tutor MTG': 'bg-pink-200 border-pink-400'
                };
                const colorClass = keywordColors[keyword] || 'bg-gray-200 border-gray-400';
                
                return `
                  <div class="text-xs p-1 rounded border ${colorClass} truncate" title="${schedule.title || ''}">
                    <div class="font-semibold">${time}</div>
                    <div>${keyword}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Render attendance statistics
 */
function renderAttendanceStatistics() {
  // Get filtered schedules
  const filteredSchedules = getFilteredSchedules();
  
  // Count attendance by tutor and keyword
  const attendanceMap = {};
  
  filteredSchedules.forEach(schedule => {
    const keyword = schedule.matched_keyword || '不明';
    const attendees = schedule.attendee_names || [];
    
    attendees.forEach(attendeeName => {
      if (!attendanceMap[attendeeName]) {
        attendanceMap[attendeeName] = {
          'ロープレ': 0,
          '1on1': 0,
          'チームMTG': 0,
          'チーム研修': 0,
          '全Tutor MTG': 0,
          total: 0
        };
      }
      
      if (attendanceMap[attendeeName][keyword] !== undefined) {
        attendanceMap[attendeeName][keyword]++;
      }
      attendanceMap[attendeeName].total++;
    });
  });
  
  // Sort by total attendance (descending)
  const sortedAttendees = Object.entries(attendanceMap).sort((a, b) => b[1].total - a[1].total);
  
  if (sortedAttendees.length === 0) {
    return `
      <tr>
        <td colspan="6" class="px-6 py-8 text-center text-gray-500">
          <i class="fas fa-inbox text-4xl mb-2"></i>
          <p>参加者データがありません</p>
        </td>
      </tr>
    `;
  }
  
  return sortedAttendees.map(([name, counts]) => {
    return `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">${name}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${counts['ロープレ']}回</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${counts['1on1']}回</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${counts['チームMTG']}回</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${counts['チーム研修']}回</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${counts['全Tutor MTG']}回</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm font-bold text-blue-600">${counts.total}回</td>
      </tr>
    `;
  }).join('');
}

/**
 * Render pending absence requests
 */
function renderPendingRequests() {
  if (!pendingRequests || pendingRequests.length === 0) {
    return `
      <div class="text-center py-12">
        <i class="fas fa-inbox text-gray-400 text-5xl mb-4"></i>
        <p class="text-gray-600 text-lg">申請中の不参加申請はありません</p>
      </div>
    `;
  }
  
  return `
    <h2 class="text-xl font-bold text-gray-800 mb-4">
      <i class="fas fa-clock mr-2"></i>申請中の不参加申請 (${pendingRequests.length}件)
    </h2>
    <div class="space-y-4">
      ${pendingRequests.map(event => {
        const keywordColors = {
          'ロープレ': 'bg-blue-100 text-blue-800',
          '1on1': 'bg-green-100 text-green-800',
          'チームMTG': 'bg-orange-100 text-orange-800',
          'チーム研修': 'bg-purple-100 text-purple-800',
          '全Tutor MTG': 'bg-pink-100 text-pink-800'
        };
        const colorClass = keywordColors[event.matched_keyword] || 'bg-gray-100 text-gray-800';
        
        return `
          <div class="border border-gray-200 rounded-lg p-4">
            <div class="flex items-start justify-between mb-3">
              <div>
                <div class="flex items-center gap-2 mb-2">
                  <span class="px-3 py-1 rounded-full text-sm font-semibold ${colorClass}">
                    ${event.matched_keyword || '-'}
                  </span>
                  <h3 class="text-lg font-semibold text-gray-900">${event.schedule_title || '（タイトルなし）'}</h3>
                </div>
                <p class="text-gray-600">
                  <i class="fas fa-calendar mr-2"></i>${event.schedule_date} ${event.schedule_time}
                </p>
              </div>
            </div>
            
            <div class="space-y-2">
              ${event.requests.map(req => `
                <div class="bg-gray-50 rounded-lg p-3 flex items-start justify-between">
                  <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="font-semibold text-gray-900">${req.tutor_name}</span>
                      <span class="px-2 py-1 rounded text-xs font-semibold ${req.absence_type === 'cancel' ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}">
                        ${req.absence_type === 'cancel' ? 'キャンセル' : 'リスケ'}
                      </span>
                    </div>
                    <p class="text-sm text-gray-600 mb-1">理由: ${req.reason || '（理由なし）'}</p>
                    <p class="text-xs text-gray-500">申請日時: ${new Date(req.created_at).toLocaleString('ja-JP')}</p>
                  </div>
                  ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'leader') ? `
                    <button 
                      onclick="approveAbsenceRequest(${req.id}, '${req.tutor_name}')" 
                      class="ml-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-semibold">
                      <i class="fas fa-check mr-1"></i>受理
                    </button>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}



// ==================== Absence Request Modal ====================

let selectedScheduleForAbsence = null;

/**
 * Open absence request modal
 */
function openAbsenceRequestModal(schedule) {
  selectedScheduleForAbsence = schedule;
  
  const modal = document.createElement('div');
  modal.id = 'absence-request-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
      <div class="flex justify-between items-center p-6 border-b">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-calendar-times mr-2 text-red-600"></i>不参加申請
        </h2>
        <button onclick="closeAbsenceRequestModal()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times text-2xl"></i>
        </button>
      </div>
      
      <div class="p-6">
        <!-- Schedule info -->
        <div class="bg-gray-50 rounded-lg p-4 mb-4">
          <div class="text-sm text-gray-600 mb-1">スケジュール詳細</div>
          <div class="font-semibold text-gray-900">${schedule.title || '（タイトルなし）'}</div>
          <div class="text-sm text-gray-600 mt-2">
            <i class="fas fa-calendar mr-1"></i>${schedule.schedule_date} ${schedule.schedule_time}
          </div>
          <div class="text-sm text-gray-600 mt-1">
            <i class="fas fa-tag mr-1"></i>${schedule.matched_keyword || '-'}
          </div>
        </div>
        
        <!-- Absence type selection -->
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">
            不参加の種別<span class="text-red-500 ml-1">*</span>
          </label>
          <div class="space-y-2">
            <label class="flex items-center p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
              <input type="radio" name="absence-type" value="cancel" class="mr-3" checked>
              <div>
                <div class="font-semibold text-gray-900">キャンセル</div>
                <div class="text-xs text-gray-500">スケジュール自体をキャンセルする</div>
              </div>
            </label>
            <label class="flex items-center p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
              <input type="radio" name="absence-type" value="reschedule" class="mr-3">
              <div>
                <div class="font-semibold text-gray-900">リスケ</div>
                <div class="text-xs text-gray-500">日程を変更する</div>
              </div>
            </label>
          </div>
        </div>
        
        <!-- Reason input -->
        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-2">
            理由<span class="text-red-500 ml-1">*</span>
          </label>
          <textarea 
            id="absence-reason" 
            rows="3" 
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="不参加の理由を入力してください"
          ></textarea>
        </div>
        
        <!-- Actions -->
        <div class="flex gap-3">
          <button 
            onclick="closeAbsenceRequestModal()" 
            class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
          >
            キャンセル
          </button>
          <button 
            onclick="submitAbsenceRequest()" 
            class="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
          >
            <i class="fas fa-paper-plane mr-2"></i>申請する
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

/**
 * Close absence request modal
 */
function closeAbsenceRequestModal() {
  const modal = document.getElementById('absence-request-modal');
  if (modal) {
    modal.remove();
  }
  selectedScheduleForAbsence = null;
}

/**
 * Submit absence request
 */
async function submitAbsenceRequest() {
  if (!selectedScheduleForAbsence) {
    alert('スケジュールが選択されていません');
    return;
  }
  
  // Check if tutor is selected
  if (!currentTutorEmail || !currentTutorName) {
    alert('ヘッダーから現在のTutorを選択してください');
    return;
  }
  
  // Get selected absence type
  const absenceTypeRadio = document.querySelector('input[name="absence-type"]:checked');
  if (!absenceTypeRadio) {
    alert('種別を選択してください');
    return;
  }
  const absenceType = absenceTypeRadio.value;
  
  // Get reason
  const reasonInput = document.getElementById('absence-reason');
  const reason = reasonInput.value.trim();
  if (!reason) {
    alert('理由を入力してください');
    return;
  }
  
  try {
    // Show loading state
    const submitButtons = document.querySelectorAll('#absence-request-modal button');
    const submitButton = Array.from(submitButtons).find(btn => btn.textContent.includes('申請する'));
    if (submitButton) {
      const originalText = submitButton.innerHTML;
      submitButton.disabled = true;
      submitButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>送信中...';
    }
    
    // Submit request
    const response = await axios.post(`${API_BASE}/api/schedules/absence`, {
      event_id: selectedScheduleForAbsence.unique_event_key || selectedScheduleForAbsence.event_id, // Use unique key if available
      tutor_email: currentTutorEmail,
      tutor_name: currentTutorName,
      absence_type: absenceType,
      reason: reason,
      schedule_date: selectedScheduleForAbsence.schedule_date,
      schedule_time: selectedScheduleForAbsence.schedule_time,
      schedule_title: selectedScheduleForAbsence.title,
      matched_keyword: selectedScheduleForAbsence.matched_keyword,
      leader_email: selectedScheduleForAbsence.account  // リーダーのメールアドレスを送信
    });
    
    if (response.data.success) {
      // Show different message based on absence type
      if (absenceType === 'reschedule') {
        alert(`不参加申請が完了しました\n種別: リスケ\n\n⚠️ 忘れずに再予約してください！`);
      } else {
        alert(`不参加申請が完了しました\n種別: キャンセル`);
      }
      closeAbsenceRequestModal();
      
      // Reload schedules to show updated absence information
      if (currentPage === 'schedules') {
        await renderSchedulesPage();
      }
    } else {
      alert('申請に失敗しました: ' + (response.data.error || '不明なエラー'));
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>申請する';
      }
    }
  } catch (error) {
    console.error('Absence request error:', error);
    alert('申請に失敗しました: ' + error.message);
    const submitButtons = document.querySelectorAll('#absence-request-modal button');
    const submitButton = Array.from(submitButtons).find(btn => btn.textContent.includes('送信中'));
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>申請する';
    }
  }
}

/**
 * Cancel/withdraw absence request
 */
async function cancelAbsenceRequest(eventId, tutorEmail) {
  if (!confirm('不参加申請を取り下げますか？')) {
    return;
  }
  
  try {
    const response = await axios.delete(`${API_BASE}/api/schedules/absence/${encodeURIComponent(eventId)}/${encodeURIComponent(tutorEmail)}`);
    
    if (response.data.success) {
      alert('不参加申請を取り下げました');
      
      // Reload schedules to show updated information
      if (currentPage === 'schedules') {
        await renderSchedulesPage();
      }
    } else {
      alert('取り下げに失敗しました: ' + (response.data.error || '不明なエラー'));
    }
  } catch (error) {
    console.error('Cancel absence request error:', error);
    alert('取り下げに失敗しました: ' + error.message);
  }
}

/**
 * Approve absence request
 */
async function approveAbsenceRequest(requestId, tutorName) {
  if (!confirm(`${tutorName} さんの不参加申請を受理しますか？`)) {
    return;
  }
  
  try {
    const response = await axios.post(`${API_BASE}/api/schedules/absence/${requestId}/approve`, {
      leader_email: currentUser.email,
      leader_name: currentUser.name || currentUser.email
    });
    
    if (response.data.success) {
      alert('不参加申請を受理しました');
      
      // Reload pending requests
      await handleScheduleTabChange('pending');
    } else {
      alert('受理に失敗しました: ' + (response.data.error || '不明なエラー'));
    }
  } catch (error) {
    console.error('Approve absence request error:', error);
    alert('受理に失敗しました: ' + error.message);
  }
}

// ==================== Current Tutor Management ====================

/**
 * Handle current tutor change
 */
function handleCurrentTutorChange(email) {
  if (!email) {
    currentTutorEmail = null;
    currentTutorName = null;
    localStorage.removeItem('currentTutorEmail');
    localStorage.removeItem('currentTutorName');
  } else {
    const tutor = tutors.find(t => t.email === email);
    if (tutor) {
      currentTutorEmail = email;
      currentTutorName = tutor.tutor_name;
      localStorage.setItem('currentTutorEmail', email);
      localStorage.setItem('currentTutorName', tutor.tutor_name);
    }
  }
  
  // Re-render header to update display
  renderHeader();
  renderApp();
}

// ==================== Absence Stats Management ====================

let absenceStats = null;
let selectedStatsYear = new Date().getFullYear();
let selectedStatsMonth = new Date().getMonth() + 1;

/**
 * Fetch absence stats for selected month
 */
async function fetchAbsenceStats(year, month) {
  try {
    const response = await axios.get(`${API_BASE}/api/schedules/absence-stats?year=${year}&month=${month}`);
    if (response.data.success) {
      absenceStats = response.data.data;
      return absenceStats;
    }
  } catch (error) {
    console.error('Error fetching absence stats:', error);
  }
  return null;
}

/**
 * Change absence stats month
 */
async function changeAbsenceStatsMonth(offset) {
  // Check permission
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'leader')) {
    return;
  }
  
  selectedStatsMonth += offset;
  if (selectedStatsMonth > 12) {
    selectedStatsMonth = 1;
    selectedStatsYear++;
  } else if (selectedStatsMonth < 1) {
    selectedStatsMonth = 12;
    selectedStatsYear--;
  }
  
  await fetchAbsenceStats(selectedStatsYear, selectedStatsMonth);
  renderAbsenceStatsSection();
}

/**
 * Render absence stats section
 */
function renderAbsenceStatsSection() {
  const statsContainer = document.getElementById('absence-stats-container');
  if (!statsContainer) return;
  
  // Check permission
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'leader')) {
    return;
  }
  
  if (!absenceStats || !absenceStats.stats || absenceStats.stats.length === 0) {
    statsContainer.innerHTML = `
      <div class="text-center py-8 text-gray-500">
        <i class="fas fa-inbox text-4xl mb-2"></i>
        <p>${selectedStatsYear}年${selectedStatsMonth}月のデータがありません</p>
      </div>
    `;
    return;
  }
  
  statsContainer.innerHTML = `
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tutor名</th>
          <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">出席予定</th>
          <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">キャンセル</th>
          <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リスケ</th>
          <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">合計</th>
          <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">出席率</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        ${absenceStats.stats.map(stat => {
          const cancelClass = stat.cancel_count >= 10 ? 'text-red-600 font-bold' : stat.cancel_count >= 5 ? 'text-orange-600 font-semibold' : 'text-gray-600';
          const rescheduleClass = stat.reschedule_count >= 10 ? 'text-red-600 font-bold' : stat.reschedule_count >= 5 ? 'text-orange-600 font-semibold' : 'text-gray-600';
          const totalClass = stat.total_count >= 15 ? 'text-red-600 font-bold' : stat.total_count >= 10 ? 'text-orange-600 font-semibold' : 'text-gray-600';
          
          // Attendance rate color coding
          const attendanceRate = stat.attendance_rate || 0;
          const attendanceRateClass = attendanceRate <= 25 ? 'text-red-600 font-bold' : 
                                     attendanceRate <= 50 ? 'text-orange-600 font-semibold' : 
                                     'text-green-600';
          
          return `
            <tr class="hover:bg-gray-50">
              <td class="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">${stat.tutor_name}</td>
              <td class="px-4 py-3 whitespace-nowrap text-center text-sm text-gray-600">${stat.scheduled_count || 0}回</td>
              <td class="px-4 py-3 whitespace-nowrap text-center text-sm ${cancelClass}">${stat.cancel_count}回</td>
              <td class="px-4 py-3 whitespace-nowrap text-center text-sm ${rescheduleClass}">${stat.reschedule_count}回</td>
              <td class="px-4 py-3 whitespace-nowrap text-center text-sm ${totalClass}">${stat.total_count}回</td>
              <td class="px-4 py-3 whitespace-nowrap text-center text-sm ${attendanceRateClass}">${attendanceRate.toFixed(1)}%</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

/**
 * ============================================
 * Authentication Functions
 * ============================================
 */

/**
 * Verify session and load user data
 */
async function verifySession() {
  if (!sessionToken) {
    return false;
  }
  
  try {
    const response = await axios.get(`${API_BASE}/api/auth/verify`, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    
    if (response.data.success) {
      currentUser = response.data.data.user;
      currentTutorEmail = currentUser.email;
      currentTutorName = currentUser.tutorName;
      return true;
    } else {
      // Session invalid
      sessionToken = null;
      localStorage.removeItem('sessionToken');
      return false;
    }
  } catch (error) {
    console.error('Session verification failed:', error);
    sessionToken = null;
    localStorage.removeItem('sessionToken');
    return false;
  }
}

/**
 * Show login page
 */
function showLoginPage() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-8">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-bold text-gray-800 mb-2">
            <i class="fas fa-user-lock mr-2 text-indigo-600"></i>
            WannaV 中央管理システム
          </h1>
          <p class="text-gray-600">ログインしてください</p>
        </div>
        
        <form id="login-form" class="space-y-6">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              メールアドレス
            </label>
            <input 
              type="email" 
              id="login-email" 
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
              required
              autocomplete="email"
            />
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              パスワード
            </label>
            <input 
              type="password" 
              id="login-password" 
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
              required
              autocomplete="current-password"
            />
          </div>
          
          <div id="login-error" class="hidden text-red-600 text-sm"></div>
          
          <button 
            type="submit" 
            class="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition font-semibold"
          >
            <i class="fas fa-sign-in-alt mr-2"></i>
            ログイン
          </button>
        </form>
      </div>
    </div>
  `;
  
  document.getElementById('login-form').addEventListener('submit', handleLogin);
}

/**
 * Handle login
 */
async function handleLogin(e) {
  e.preventDefault();
  
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');
  
  try {
    const response = await axios.post(`${API_BASE}/api/auth/login`, {
      email,
      password
    });
    
    if (response.data.success) {
      sessionToken = response.data.data.sessionToken;
      currentUser = response.data.data.user;
      currentTutorEmail = currentUser.email;
      currentTutorName = currentUser.tutorName;
      
      localStorage.setItem('sessionToken', sessionToken);
      
      // Check if password change is required
      if (currentUser.mustChangePassword) {
        showChangePasswordPage(true); // true = first time
      } else {
        // Load main app
        renderHeader();
        await loadInitialData();
        await renderApp();
      }
    } else {
      errorDiv.textContent = response.data.error || 'ログインに失敗しました';
      errorDiv.classList.remove('hidden');
    }
  } catch (error) {
    errorDiv.textContent = error.response?.data?.error || 'ログインに失敗しました';
    errorDiv.classList.remove('hidden');
  }
}

/**
 * Show change password page
 */
function showChangePasswordPage(isFirstTime = false) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-8">
        <div class="text-center mb-8">
          <h1 class="text-2xl font-bold text-gray-800 mb-2">
            <i class="fas fa-key mr-2 text-indigo-600"></i>
            パスワード変更${isFirstTime ? '（初回ログイン）' : ''}
          </h1>
          ${isFirstTime ? '<p class="text-sm text-gray-600">初回ログインのため、パスワードを変更してください</p>' : ''}
        </div>
        
        <form id="change-password-form" class="space-y-6">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              現在のパスワード
            </label>
            <input 
              type="password" 
              id="current-password" 
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
              required
            />
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              新しいパスワード（4文字以上）
            </label>
            <input 
              type="password" 
              id="new-password" 
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
              required
              minlength="4"
            />
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              新しいパスワード（確認）
            </label>
            <input 
              type="password" 
              id="confirm-password" 
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
              required
              minlength="4"
            />
          </div>
          
          <div id="change-password-error" class="hidden text-red-600 text-sm"></div>
          
          <button 
            type="submit" 
            class="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition font-semibold"
          >
            <i class="fas fa-check mr-2"></i>
            パスワードを変更する
          </button>
        </form>
      </div>
    </div>
  `;
  
  document.getElementById('change-password-form').addEventListener('submit', (e) => handleChangePassword(e, isFirstTime));
}

/**
 * Handle change password
 */
async function handleChangePassword(e, isFirstTime) {
  e.preventDefault();
  
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  const errorDiv = document.getElementById('change-password-error');
  
  if (newPassword !== confirmPassword) {
    errorDiv.textContent = 'パスワードが一致しません';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  try {
    const response = await axios.post(`${API_BASE}/api/auth/change-password`, {
      currentPassword,
      newPassword
    }, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    
    if (response.data.success) {
      alert('パスワードを変更しました');
      currentUser.mustChangePassword = false;
      
      // Reload app with header and data
      renderHeader();
      await loadInitialData();
      await renderApp();
    } else {
      errorDiv.textContent = response.data.error || 'パスワード変更に失敗しました';
      errorDiv.classList.remove('hidden');
    }
  } catch (error) {
    errorDiv.textContent = error.response?.data?.error || 'パスワード変更に失敗しました';
    errorDiv.classList.remove('hidden');
  }
}

/**
 * Logout
 */
async function logout() {
  if (confirm('ログアウトしますか?')) {
    try {
      await axios.post(`${API_BASE}/api/auth/logout`, {}, {
        headers: {
          'Authorization': `Bearer ${sessionToken}`
        }
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
    
    sessionToken = null;
    currentUser = null;
    currentTutorEmail = null;
    currentTutorName = null;
    localStorage.removeItem('sessionToken');
    showLoginPage();
  }
}


/**
 * ============================================
 * User Management Page (Admin Only)
 * ============================================
 */

/**
 * Render users management page
 */
async function renderUsersPage() {
  const content = document.getElementById('content');
  
  // Check if user is admin
  if (!currentUser || currentUser.role !== 'admin') {
    content.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <i class="fas fa-exclamation-triangle text-red-600 text-4xl mb-4"></i>
        <h2 class="text-xl font-bold text-red-800 mb-2">アクセス拒否</h2>
        <p class="text-red-700">このページは管理者のみアクセスできます</p>
      </div>
    `;
    return;
  }
  
  // Show loading
  content.innerHTML = `
    <div class="text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
      <p class="mt-4 text-gray-600">ユーザー一覧を読み込んでいます...</p>
    </div>
  `;
  
  try {
    // Fetch users
    const response = await axios.get(`${API_BASE}/api/users`, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    
    const users = response.data.data;
    
    content.innerHTML = `
      <div class="bg-white rounded-lg shadow-md p-6">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-users-cog mr-2 text-indigo-600"></i>
            ユーザー管理
          </h2>
          <div class="flex gap-2">
            <button onclick="checkDiscordMapping()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              <i class="fab fa-discord mr-2"></i>Discord紐付け確認
            </button>
            <button onclick="showCreateUserModal()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
              <i class="fas fa-plus mr-2"></i>ユーザーを追加
            </button>
          </div>
        </div>
        
        <!-- Users table -->
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="bg-gray-50 border-b">
                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">ID</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">メールアドレス</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">Tutor名</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">権限</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">Discord設定</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">パスワード変更必須</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">最終ログイン</th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(user => `
                <tr class="border-b hover:bg-gray-50">
                  <td class="px-4 py-3 text-sm">${user.id}</td>
                  <td class="px-4 py-3 text-sm">${user.email}</td>
                  <td class="px-4 py-3 text-sm">${user.tutor_name || '-'}</td>
                  <td class="px-4 py-3">
                    <select 
                      class="px-2 py-1 border rounded text-sm ${getRoleBadgeClass(user.role)}"
                      onchange="updateUserRole(${user.id}, this.value)"
                    >
                      <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理者</option>
                      <option value="leader" ${user.role === 'leader' ? 'selected' : ''}>リーダー</option>
                      <option value="crew" ${user.role === 'crew' ? 'selected' : ''}>クルー</option>
                    </select>
                  </td>
                  <td class="px-4 py-3">
                    <button 
                      onclick="showEditDiscordModal(${user.id}, '${user.email}', ${user.discord_webhook_url ? `'${user.discord_webhook_url}'` : 'null'}, ${user.discord_user_id ? `'${user.discord_user_id}'` : 'null'})"
                      class="px-3 py-1 bg-indigo-500 text-white rounded text-sm hover:bg-indigo-600 transition"
                      title="Discord設定を編集"
                    >
                      <i class="fab fa-discord mr-1"></i>
                      ${user.discord_webhook_url || user.discord_user_id ? '設定済み' : '未設定'}
                    </button>
                  </td>
                  <td class="px-4 py-3 text-sm">
                    ${user.must_change_password ? '<span class="text-orange-600">はい</span>' : '<span class="text-gray-500">いいえ</span>'}
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-600">
                    ${user.last_login ? new Date(user.last_login).toLocaleString('ja-JP') : '-'}
                  </td>
                  <td class="px-4 py-3">
                    <button 
                      onclick="resetUserPassword(${user.id}, '${user.email}')"
                      class="px-3 py-1 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600 transition mr-2"
                      title="パスワードを初期化"
                    >
                      <i class="fas fa-key"></i>
                    </button>
                    <button 
                      onclick="deleteUser(${user.id}, '${user.email}')"
                      class="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition"
                      title="ユーザーを削除"
                    >
                      <i class="fas fa-trash"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    
  } catch (error) {
    console.error('Failed to load users:', error);
    console.error('Error details:', error.response?.data);
    const errorMessage = error.response?.data?.error || error.message || '不明なエラー';
    content.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <i class="fas fa-exclamation-circle text-red-600 text-4xl mb-4"></i>
        <h2 class="text-xl font-bold text-red-800 mb-2">エラー</h2>
        <p class="text-red-700 mb-2">ユーザー一覧の読み込みに失敗しました</p>
        <p class="text-sm text-red-600">${errorMessage}</p>
        <button onclick="renderUsersPage()" class="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">
          <i class="fas fa-sync-alt mr-2"></i>再試行
        </button>
      </div>
    `;
  }
}

/**
 * Get role badge class
 */
function getRoleBadgeClass(role) {
  switch(role) {
    case 'admin': return 'bg-red-100 text-red-800 border-red-300';
    case 'leader': return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'crew': return 'bg-gray-100 text-gray-800 border-gray-300';
    default: return 'bg-gray-100 text-gray-800 border-gray-300';
  }
}

/**
 * Show create user modal
 */
function showCreateUserModal() {
  const modal = document.createElement('div');
  modal.id = 'create-user-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
      <div class="flex justify-between items-center p-6 border-b">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-user-plus mr-2 text-indigo-600"></i>ユーザーを追加
        </h2>
        <button onclick="closeCreateUserModal()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times text-2xl"></i>
        </button>
      </div>
      
      <form id="create-user-form" class="p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            メールアドレス
          </label>
          <input 
            type="email" 
            id="create-user-email" 
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
            required
          />
          <p class="text-xs text-gray-500 mt-1">Tutorテーブルのメールアドレスと照合されます</p>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            権限
          </label>
          <select 
            id="create-user-role" 
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            required
          >
            <option value="crew">クルー</option>
            <option value="leader">リーダー</option>
            <option value="admin">管理者</option>
          </select>
        </div>
        
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p class="text-sm text-blue-800">
            <i class="fas fa-info-circle mr-2"></i>
            初期パスワードは <strong>1111</strong> に設定されます
          </p>
        </div>
        
        <div id="create-user-error" class="hidden text-red-600 text-sm"></div>
        
        <div class="flex gap-2">
          <button 
            type="button"
            onclick="closeCreateUserModal()"
            class="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition"
          >
            キャンセル
          </button>
          <button 
            type="submit"
            class="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            <i class="fas fa-plus mr-2"></i>追加する
          </button>
        </div>
      </form>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.getElementById('create-user-form').addEventListener('submit', handleCreateUser);
}

/**
 * Close create user modal
 */
function closeCreateUserModal() {
  const modal = document.getElementById('create-user-modal');
  if (modal) {
    modal.remove();
  }
}

/**
 * Handle create user
 */
async function handleCreateUser(e) {
  e.preventDefault();
  
  const email = document.getElementById('create-user-email').value;
  const role = document.getElementById('create-user-role').value;
  const errorDiv = document.getElementById('create-user-error');
  
  try {
    const response = await axios.post(`${API_BASE}/api/users`, {
      email,
      role
    }, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    
    if (response.data.success) {
      alert(response.data.message);
      closeCreateUserModal();
      await renderUsersPage();
    } else {
      errorDiv.textContent = response.data.error;
      errorDiv.classList.remove('hidden');
    }
  } catch (error) {
    errorDiv.textContent = error.response?.data?.error || 'ユーザー作成に失敗しました';
    errorDiv.classList.remove('hidden');
  }
}

/**
 * Update user role
 */
async function updateUserRole(userId, newRole) {
  if (!confirm('このユーザーの権限を変更しますか?')) {
    await renderUsersPage(); // Reset select
    return;
  }
  
  try {
    const response = await axios.put(`${API_BASE}/api/users/${userId}`, {
      role: newRole
    }, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    
    if (response.data.success) {
      alert(response.data.message);
      await renderUsersPage();
    } else {
      alert('エラー: ' + response.data.error);
      await renderUsersPage();
    }
  } catch (error) {
    alert('権限更新に失敗しました: ' + (error.response?.data?.error || error.message));
    await renderUsersPage();
  }
}

/**
 * Reset user password
 */
async function resetUserPassword(userId, email) {
  if (!confirm(`${email} のパスワードを初期値（1111）にリセットしますか？\n次回ログイン時にパスワード変更が必須となります。`)) {
    return;
  }
  
  try {
    const response = await axios.post(`${API_BASE}/api/auth/reset-password`, {
      userId
    }, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    
    if (response.data.success) {
      alert(response.data.message);
      await renderUsersPage();
    } else {
      alert('エラー: ' + response.data.error);
    }
  } catch (error) {
    alert('パスワードリセットに失敗しました: ' + (error.response?.data?.error || error.message));
  }
}

/**
 * Delete user
 */
async function deleteUser(userId, email) {
  if (!confirm(`本当に ${email} を削除しますか？\nこの操作は取り消せません。`)) {
    return;
  }
  
  try {
    const response = await axios.delete(`${API_BASE}/api/users/${userId}`, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    
    if (response.data.success) {
      alert(response.data.message);
      await renderUsersPage();
    } else {
      alert('エラー: ' + response.data.error);
    }
  } catch (error) {
    alert('ユーザー削除に失敗しました: ' + (error.response?.data?.error || error.message));
  }
}

/**
 * Show edit Discord settings modal
 */
function showEditDiscordModal(userId, email, webhookUrl, discordUserId) {
  const modal = document.createElement('div');
  modal.id = 'edit-discord-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
      <div class="flex justify-between items-center p-6 border-b">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fab fa-discord mr-2 text-indigo-600"></i>Discord設定を編集
        </h2>
        <button onclick="closeEditDiscordModal()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times text-2xl"></i>
        </button>
      </div>
      
      <form id="edit-discord-form" class="p-6 space-y-6">
        <input type="hidden" id="discord-user-id-field" value="${userId}">
        
        <!-- User info -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p class="text-sm text-blue-800">
            <i class="fas fa-info-circle mr-2"></i>
            <strong>${email}</strong> のDiscord設定
          </p>
        </div>
        
        <!-- Discord Webhook URL -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            <i class="fas fa-link mr-2"></i>Discord Webhook URL
          </label>
          <input 
            type="url" 
            id="discord-webhook-url" 
            value="${webhookUrl || ''}"
            placeholder="https://discord.com/api/webhooks/..."
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
          <p class="mt-2 text-xs text-gray-500">
            <i class="fas fa-question-circle mr-1"></i>
            Discord チャンネルの設定から Webhook URL を取得してください
          </p>
        </div>
        
        <!-- Discord User ID -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            <i class="fas fa-user mr-2"></i>Discord User ID
          </label>
          <input 
            type="text" 
            id="discord-user-id-input" 
            value="${discordUserId || ''}"
            placeholder="123456789012345678"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
          <p class="mt-2 text-xs text-gray-500">
            <i class="fas fa-question-circle mr-1"></i>
            Discord で開発者モードを有効にし、ユーザーを右クリックして「IDをコピー」
          </p>
        </div>
        
        <!-- Buttons -->
        <div class="flex justify-end gap-3 pt-4 border-t">
          <button 
            type="button" 
            onclick="closeEditDiscordModal()"
            class="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
          >
            キャンセル
          </button>
          <button 
            type="submit"
            class="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            <i class="fas fa-save mr-2"></i>保存
          </button>
        </div>
      </form>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Handle form submission
  document.getElementById('edit-discord-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveDiscordSettings();
  });
}

/**
 * Close edit Discord modal
 */
function closeEditDiscordModal() {
  const modal = document.getElementById('edit-discord-modal');
  if (modal) {
    modal.remove();
  }
}

/**
 * Save Discord settings
 */
async function saveDiscordSettings() {
  const userId = document.getElementById('discord-user-id-field').value;
  const webhookUrl = document.getElementById('discord-webhook-url').value.trim();
  const discordUserId = document.getElementById('discord-user-id-input').value.trim();
  
  try {
    const response = await axios.put(`${API_BASE}/api/users/${userId}/discord`, {
      discord_webhook_url: webhookUrl || null,
      discord_user_id: discordUserId || null
    }, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    
    if (response.data.success) {
      alert('Discord設定を保存しました');
      closeEditDiscordModal();
      await renderUsersPage();
    } else {
      alert('エラー: ' + response.data.error);
    }
  } catch (error) {
    alert('Discord設定の保存に失敗しました: ' + (error.response?.data?.error || error.message));
  }
}

/**
 * Check Discord mapping for tutors and leaders
 */
async function checkDiscordMapping() {
  try {
    // Show loading modal
    const loadingModal = document.createElement('div');
    loadingModal.id = 'discord-mapping-modal';
    loadingModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    loadingModal.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-hidden">
        <div class="flex justify-between items-center p-6 border-b">
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fab fa-discord mr-2 text-indigo-600"></i>Discord紐付け確認
          </h2>
          <button onclick="closeDiscordMappingModal()" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times text-2xl"></i>
          </button>
        </div>
        
        <div class="p-6 text-center">
          <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
          <p class="mt-4 text-gray-600">データを読み込んでいます...</p>
        </div>
      </div>
    `;
    
    document.body.appendChild(loadingModal);
    
    // Fetch mapping data
    const response = await axios.get(`${API_BASE}/api/lesson-report-reminder/check-mapping`);
    const data = response.data.data;
    
    // Build summary HTML
    const summaryHtml = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="bg-blue-50 p-4 rounded-lg">
          <div class="text-sm text-blue-600 mb-1">アクティブTutor</div>
          <div class="text-2xl font-bold text-blue-800">${data.summary.total_active_tutors}</div>
        </div>
        <div class="bg-green-50 p-4 rounded-lg">
          <div class="text-sm text-green-600 mb-1">Discord設定済み</div>
          <div class="text-2xl font-bold text-green-800">${data.summary.tutors_with_discord}</div>
        </div>
        <div class="bg-red-50 p-4 rounded-lg">
          <div class="text-sm text-red-600 mb-1">Discord未設定</div>
          <div class="text-2xl font-bold text-red-800">${data.summary.tutors_without_discord}</div>
        </div>
        <div class="bg-purple-50 p-4 rounded-lg">
          <div class="text-sm text-purple-600 mb-1">リーダー数</div>
          <div class="text-2xl font-bold text-purple-800">${data.summary.total_leaders}</div>
        </div>
      </div>
      
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <h3 class="font-semibold text-yellow-800 mb-2">
          <i class="fas fa-calendar-day mr-2"></i>前日のレッスン (${data.summary.yesterday_date})
        </h3>
        ${data.summary.yesterday_lessons.length === 0 ? '<p class="text-sm text-yellow-700">前日のレッスンはありません</p>' : `
          <div class="space-y-2">
            ${data.summary.yesterday_lessons.map(lesson => `
              <div class="text-sm text-yellow-800">
                <strong>${lesson.tutor_name || lesson.homeroom_tutor}</strong>: ${lesson.lesson_count}件
                ${lesson.tutor_email ? `(${lesson.tutor_email})` : ''}
                ${lesson.team ? `[${lesson.team}]` : ''}
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
    
    // Build tutor mapping table
    const tutorTableHtml = `
      <div class="overflow-y-auto max-h-96">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 sticky top-0">
            <tr>
              <th class="px-3 py-2 text-left font-semibold text-gray-700">Tutor名</th>
              <th class="px-3 py-2 text-left font-semibold text-gray-700">メール</th>
              <th class="px-3 py-2 text-left font-semibold text-gray-700">チーム</th>
              <th class="px-3 py-2 text-center font-semibold text-gray-700">Discord設定</th>
              <th class="px-3 py-2 text-left font-semibold text-gray-700">チームリーダー</th>
              <th class="px-3 py-2 text-center font-semibold text-gray-700">通知</th>
            </tr>
          </thead>
          <tbody>
            ${data.tutor_mapping.map(tutor => `
              <tr class="border-b hover:bg-gray-50">
                <td class="px-3 py-2">${tutor.tutor_name}</td>
                <td class="px-3 py-2 text-xs">${tutor.email || '-'}</td>
                <td class="px-3 py-2">
                  <span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                    ${tutor.team || '-'}
                  </span>
                </td>
                <td class="px-3 py-2 text-center">
                  ${tutor.has_discord_webhook 
                    ? '<span class="text-green-600"><i class="fas fa-check-circle"></i> 設定済み</span>' 
                    : '<span class="text-red-600"><i class="fas fa-times-circle"></i> 未設定</span>'}
                </td>
                <td class="px-3 py-2">
                  ${tutor.team_leaders.length > 0 
                    ? tutor.team_leaders.map(leader => `
                        <div class="text-xs mb-1">
                          <span class="font-medium">${leader.tutor_name || leader.email}</span>
                          <span class="text-gray-500">(${leader.role})</span>
                          ${leader.has_webhook 
                            ? '<i class="fas fa-check text-green-600 ml-1"></i>' 
                            : '<i class="fas fa-times text-red-600 ml-1"></i>'}
                        </div>
                      `).join('')
                    : '<span class="text-gray-400 text-xs">リーダーなし</span>'}
                </td>
                <td class="px-3 py-2 text-center">
                  ${tutor.will_receive_notifications 
                    ? '<span class="text-green-600 font-semibold">○</span>' 
                    : '<span class="text-red-600 font-semibold">×</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    
    // Update modal content
    loadingModal.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div class="flex justify-between items-center p-6 border-b">
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fab fa-discord mr-2 text-indigo-600"></i>Discord紐付け確認
          </h2>
          <button onclick="closeDiscordMappingModal()" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times text-2xl"></i>
          </button>
        </div>
        
        <div class="p-6 overflow-y-auto">
          ${summaryHtml}
          
          <h3 class="text-lg font-bold text-gray-800 mb-4">
            <i class="fas fa-list mr-2"></i>Tutor一覧とDiscord設定
          </h3>
          
          ${tutorTableHtml}
        </div>
        
        <div class="p-4 border-t bg-gray-50 flex justify-end">
          <button 
            onclick="closeDiscordMappingModal()"
            class="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition"
          >
            閉じる
          </button>
        </div>
      </div>
    `;
    
  } catch (error) {
    console.error('Discord mapping check error:', error);
    alert('Discord紐付け確認に失敗しました: ' + (error.response?.data?.error || error.message));
    closeDiscordMappingModal();
  }
}

/**
 * Close Discord mapping modal
 */
function closeDiscordMappingModal() {
  const modal = document.getElementById('discord-mapping-modal');
  if (modal) {
    modal.remove();
  }
}

/**
 * Get Notion name from tutor name
 */
function getTutorNotionName(tutorName) {
  if (!tutorName) return null;
  
  // Find matching tutor by tutor_name
  const tutor = tutors.find(t => t.tutor_name === tutorName);
  
  if (tutor && tutor.notion_name) {
    return tutor.notion_name;
  }
  
  return null;
}

// Change extension tutor for badge display
function changeExtensionTutor(tutorName) {
  selectedExtensionTutor = tutorName;
  updateExtensionBadges();
  // Reload page to show updated stats
  renderExtensionsPage();
}

// Render Extensions Management Page
async function renderExtensionsPage() {
  const content = document.getElementById('content');
  
  // Show loading
  content.innerHTML = `
    <div class="text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
      <p class="mt-4 text-gray-600">延長管理データを読み込んでいます...</p>
    </div>
  `;

  try {
    // Fetch statistics
    const statsRes = await axios.get('/api/extensions/stats');
    const tutorRes = await axios.get('/api/extensions/by-tutor');
    const teamRes = await axios.get('/api/extensions/by-team');
    
    if (!statsRes.data.success || !tutorRes.data.success || !teamRes.data.success) {
      throw new Error('データの取得に失敗しました');
    }

    const stats = statsRes.data.data;
    const tutorList = tutorRes.data.data;
    const teamList = teamRes.data.data;
    
    // Store tutor stats globally
    extensionTutorStats = tutorList;
    
    // Check if user is leader or admin
    const canSelectTutor = currentUser && (currentUser.role === 'admin' || currentUser.role === 'leader');
    
    // Set default selected tutor to current user's tutor
    if (!selectedExtensionTutor && currentTutorName) {
      selectedExtensionTutor = currentTutorName;
    }
    
    // Find current tutor's stats
    const currentTutorStats = tutorList.find(t => t.tutorName === selectedExtensionTutor);

    content.innerHTML = `
      <div class="space-y-6">
        <!-- Page Title -->
        <div class="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg shadow-lg p-6">
          <div class="flex justify-between items-center">
            <div>
              <h2 class="text-3xl font-bold">
                <i class="fas fa-sync-alt mr-3"></i>延長管理
              </h2>
              <p class="mt-2 text-purple-100">生徒の延長審査状況とTutor別ヒアリング対象を管理します</p>
            </div>
            ${canSelectTutor ? `
              <div class="bg-white/10 backdrop-blur-sm rounded-lg p-3">
                <label class="text-sm text-purple-100 block mb-1">Tutor選択</label>
                <select id="extension-tutor-select" class="px-3 py-2 rounded bg-white text-gray-800 font-semibold min-w-[150px]" onchange="changeExtensionTutor(this.value)">
                  ${tutorList.map(t => `
                    <option value="${t.tutorName}" ${t.tutorName === selectedExtensionTutor ? 'selected' : ''}>
                      ${t.tutorName}
                    </option>
                  `).join('')}
                </select>
                <p class="text-xs text-purple-100 mt-1">※バッジ表示用</p>
              </div>
            ` : ''}
          </div>
        </div>
        
        ${currentTutorStats ? `
        <!-- Current Tutor Badge Stats -->
        <div class="bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-lg shadow-lg p-6">
          <h3 class="text-xl font-bold mb-4">
            <i class="fas fa-user-check mr-2"></i>${selectedExtensionTutor} の未完了タスク
          </h3>
          <div class="grid grid-cols-2 gap-4">
            <div class="bg-white/20 backdrop-blur-sm rounded-lg p-4">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm text-orange-100 mb-1">ヒアリング未完了</div>
                  <div class="text-3xl font-bold">${currentTutorStats.hearingIncompleteCount}人</div>
                </div>
                <div class="bg-orange-500 text-white rounded-full h-12 w-12 flex items-center justify-center text-xl font-bold">
                  ${currentTutorStats.hearingIncompleteCount}
                </div>
              </div>
              <div class="text-xs text-orange-100 mt-2">
                対象: ${currentTutorStats.hearingTargetCount}人 / 4ヶ月目・10ヶ月目
              </div>
            </div>
            <div class="bg-white/20 backdrop-blur-sm rounded-lg p-4">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm text-red-100 mb-1">審査未完了</div>
                  <div class="text-3xl font-bold">${currentTutorStats.examIncompleteCount}人</div>
                </div>
                <div class="bg-red-600 text-white rounded-full h-12 w-12 flex items-center justify-center text-xl font-bold">
                  ${currentTutorStats.examIncompleteCount}
                </div>
              </div>
              <div class="text-xs text-red-100 mt-2">
                対象: ${currentTutorStats.examTargetCount}人 / 5ヶ月目・11ヶ月目
              </div>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- Overall Statistics -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h3 class="text-xl font-bold text-gray-800 mb-4">
            <i class="fas fa-chart-bar mr-2 text-purple-600"></i>全体統計
          </h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-blue-50 rounded-lg p-4">
              <div class="text-sm text-gray-600 mb-1">延長対象数</div>
              <div class="text-2xl font-bold text-blue-600">${stats.targetCount}人</div>
            </div>
            <div class="bg-green-50 rounded-lg p-4">
              <div class="text-sm text-gray-600 mb-1">延長確度記入済み</div>
              <div class="text-2xl font-bold text-green-600">${stats.certaintyFilledCount}人</div>
            </div>
            <div class="bg-purple-50 rounded-lg p-4">
              <div class="text-sm text-gray-600 mb-1">延長数</div>
              <div class="text-2xl font-bold text-purple-600">${stats.extensionCount}人</div>
            </div>
            <div class="bg-red-50 rounded-lg p-4">
              <div class="text-sm text-gray-600 mb-1">退会数</div>
              <div class="text-2xl font-bold text-red-600">${stats.withdrawalCount}人</div>
            </div>
            <div class="bg-indigo-50 rounded-lg p-4">
              <div class="text-sm text-gray-600 mb-1">延長率</div>
              <div class="text-2xl font-bold text-indigo-600">${stats.extensionRate}%</div>
            </div>
            <div class="bg-pink-50 rounded-lg p-4">
              <div class="text-sm text-gray-600 mb-1">延長率（対 結果お伝え）</div>
              <div class="text-2xl font-bold text-pink-600">${stats.extensionRateVsResult}%</div>
            </div>
            <div class="bg-yellow-50 rounded-lg p-4">
              <div class="text-sm text-gray-600 mb-1">残弾数</div>
              <div class="text-2xl font-bold text-yellow-600">${stats.remainingCount}人</div>
            </div>
          </div>
        </div>

        <!-- Extension Review Statistics -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- 1st Review (5 months) -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-xl font-bold text-gray-800 mb-4">
              <i class="fas fa-1 mr-2 text-blue-600"></i>1回目延長審査（5ヶ月目）
            </h3>
            <div class="space-y-3">
              <div class="flex justify-between items-center">
                <span class="text-gray-600">対象数</span>
                <span class="text-xl font-bold text-gray-800">${stats.exam1st.targetCount}人</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-gray-600">延長数</span>
                <span class="text-xl font-bold text-green-600">${stats.exam1st.extensionCount}人</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-gray-600">延長率</span>
                <span class="text-xl font-bold text-blue-600">${stats.exam1st.extensionRate}%</span>
              </div>
            </div>
          </div>

          <!-- 2nd Review (11 months) -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-xl font-bold text-gray-800 mb-4">
              <i class="fas fa-2 mr-2 text-purple-600"></i>2回目延長審査（11ヶ月目）
            </h3>
            <div class="space-y-3">
              <div class="flex justify-between items-center">
                <span class="text-gray-600">対象数</span>
                <span class="text-xl font-bold text-gray-800">${stats.exam2nd.targetCount}人</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-gray-600">延長数</span>
                <span class="text-xl font-bold text-green-600">${stats.exam2nd.extensionCount}人</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-gray-600">延長率</span>
                <span class="text-xl font-bold text-purple-600">${stats.exam2nd.extensionRate}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Team Statistics -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h3 class="text-xl font-bold text-gray-800 mb-4">
            <i class="fas fa-users-cog mr-2 text-purple-600"></i>チーム別延長率
          </h3>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">チーム名</th>
                  <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">延長対象数</th>
                  <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">延長数</th>
                  <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">退会数</th>
                  <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">延長率</th>
                  <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">1回目延長率</th>
                  <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">2回目延長率</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                ${teamList.map(team => `
                  <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 text-sm font-medium text-gray-800">${team.teamName}</td>
                    <td class="px-4 py-3 text-center text-sm text-gray-600">${team.targetCount}人</td>
                    <td class="px-4 py-3 text-center text-sm text-green-600 font-semibold">${team.extensionCount}人</td>
                    <td class="px-4 py-3 text-center text-sm text-red-600">${team.withdrawalCount}人</td>
                    <td class="px-4 py-3 text-center text-sm">
                      <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
                        team.extensionRate >= 80 ? 'bg-green-100 text-green-800' :
                        team.extensionRate >= 60 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }">
                        ${team.extensionRate}%
                      </span>
                    </td>
                    <td class="px-4 py-3 text-center text-sm text-gray-600">
                      ${team.exam1stExtensionRate}% <span class="text-xs text-gray-400">(${team.exam1stExtensionCount}/${team.exam1stTargetCount})</span>
                    </td>
                    <td class="px-4 py-3 text-center text-sm text-gray-600">
                      ${team.exam2ndExtensionRate}% <span class="text-xs text-gray-400">(${team.exam2ndExtensionCount}/${team.exam2ndTargetCount})</span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tutor List -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h3 class="text-xl font-bold text-gray-800 mb-4">
            <i class="fas fa-users mr-2 text-indigo-600"></i>Tutor別ヒアリング・審査対象
          </h3>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">Tutor名</th>
                  <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">ヒアリング対象数</th>
                  <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">ヒアリング未完了</th>
                  <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">延長審査対象数</th>
                  <th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">審査未完了</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                ${tutorList.map(tutor => `
                  <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 text-sm font-medium text-gray-800">${tutor.tutorName}</td>
                    <td class="px-4 py-3 text-center text-sm text-gray-600">${tutor.hearingTargetCount}人</td>
                    <td class="px-4 py-3 text-center text-sm ${tutor.hearingIncompleteCount > 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}">${tutor.hearingIncompleteCount}人</td>
                    <td class="px-4 py-3 text-center text-sm text-gray-600">${tutor.examTargetCount}人</td>
                    <td class="px-4 py-3 text-center text-sm ${tutor.examIncompleteCount > 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}">${tutor.examIncompleteCount}人</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

  } catch (error) {
    console.error('Error loading extensions page:', error);
    
    // Determine error message based on error response
    let errorTitle = 'エラーが発生しました';
    let errorMessage = error.message || '不明なエラー';
    let errorDetail = '';
    
    if (error.response) {
      if (error.response.status === 503) {
        errorTitle = '延長審査DBが設定されていません';
        errorMessage = error.response.data?.error || 'データベースが設定されていません';
        errorDetail = 'Render.comの環境変数でEXTENSION_DATABASE_URLを設定してください';
      } else {
        errorMessage = error.response.data?.error || `サーバーエラー (${error.response.status})`;
        errorDetail = '延長審査DBの接続を確認してください';
      }
    }
    
    content.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <i class="fas fa-exclamation-triangle text-4xl text-red-600 mb-4"></i>
        <h3 class="text-xl font-bold text-red-800 mb-2">${errorTitle}</h3>
        <p class="text-red-600 mb-2">${errorMessage}</p>
        ${errorDetail ? `<p class="text-sm text-red-500 mt-2">${errorDetail}</p>` : ''}
      </div>
    `;
  }
  
  // Update badges after rendering
  updateExtensionBadges();
}

/**
 * Render Suspensions Page
 */
async function renderSuspensionsPage() {
  const content = document.getElementById('content');
  
  // Show loading spinner
  content.innerHTML = `
    <div class="flex justify-center items-center min-h-screen">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>
  `;
  
  try {
    // Fetch suspension data
    const response = await axios.get('/api/suspensions');
    const suspensions = response.data.data || [];
    
    // Render page
    content.innerHTML = `
      <div class="max-w-7xl mx-auto">
        <div class="bg-white rounded-lg shadow-md p-6 mb-6">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-2xl font-bold text-gray-800">
              <i class="fas fa-pause-circle mr-2 text-blue-600"></i>休会管理
            </h2>
            <div class="text-sm text-gray-600">
              <i class="fas fa-users mr-2"></i>休会中: <span class="font-bold text-lg">${suspensions.length}</span>名
            </div>
          </div>
          
          <!-- Suspensions Table -->
          <div class="overflow-x-auto">
            <table class="min-w-full bg-white border border-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">生徒名</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">学籍番号</th>
                  <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-b">休会期間</th>
                  <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-b">休会開始日</th>
                  <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-b">休会終了予定</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                ${suspensions.length === 0 ? `
                  <tr>
                    <td colspan="5" class="px-6 py-8 text-center text-gray-500">
                      <i class="fas fa-info-circle mr-2"></i>休会中の生徒はいません
                    </td>
                  </tr>
                ` : suspensions.map(s => `
                  <tr class="hover:bg-gray-50 transition">
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="font-medium text-gray-900">${s.studentName}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="text-sm text-gray-600">${s.studentId}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center">
                      <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-orange-100 text-orange-800">
                        <i class="fas fa-calendar mr-1"></i>${s.suspensionMonths}ヶ月
                      </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600">
                      ${s.suspensionStartDate || '-'}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center">
                      <span class="text-sm font-medium text-blue-600">
                        ${s.suspensionEndDate || '-'}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error loading suspensions page:', error);
    content.innerHTML = `
      <div class="max-w-4xl mx-auto">
        <div class="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 class="text-lg font-semibold text-red-800 mb-2">
            <i class="fas fa-exclamation-triangle mr-2"></i>エラーが発生しました
          </h3>
          <p class="text-red-600">休会データの読み込みに失敗しました。</p>
          <p class="text-sm text-red-500 mt-2">Google Sheetsの接続を確認してください。</p>
        </div>
      </div>
    `;
  }
}

/**
 * Render Database Management Page
 */
async function renderDatabasePage() {
  const content = document.getElementById('content');
  
  // Show loading
  content.innerHTML = `
    <div class="text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
      <p class="mt-4 text-gray-600">データベース情報を読み込んでいます...</p>
    </div>
  `;

  try {
    // Fetch database stats
    const statsRes = await axios.get(`${API_BASE}/api/database/stats`);
    const connectionRes = await axios.get(`${API_BASE}/api/database/connection-info`);
    
    if (!statsRes.data.success || !connectionRes.data.success) {
      throw new Error('データの取得に失敗しました');
    }

    const stats = statsRes.data.data;
    const connections = connectionRes.data.data;

    content.innerHTML = `
      <div class="space-y-6">
        <!-- Page Title -->
        <div class="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg shadow-lg p-6">
          <div class="flex justify-between items-start">
            <div>
              <h2 class="text-3xl font-bold">
                <i class="fas fa-database mr-3"></i>データベース管理
              </h2>
              <p class="mt-2 text-indigo-100">データベースの使用状況とパフォーマンスを確認します</p>
            </div>
            <button onclick="runDatabaseMigration()" 
                    class="px-4 py-2 bg-white text-indigo-600 font-semibold rounded-lg hover:bg-indigo-50 transition">
              <i class="fas fa-sync-alt mr-2"></i>マイグレーション実行
            </button>
          </div>
        </div>

        <!-- Main Database Stats -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h3 class="text-xl font-bold text-gray-800 mb-4">
            <i class="fas fa-server mr-2 text-indigo-600"></i>メインデータベース
          </h3>
          
          ${stats.mainDatabase.error ? `
            <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              <i class="fas fa-exclamation-triangle mr-2"></i>${stats.mainDatabase.error}
            </div>
          ` : `
            <!-- Overview Cards -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div class="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="text-sm text-gray-600 mb-1">データベース容量</div>
                    <div class="text-2xl font-bold text-blue-600">${stats.mainDatabase.totalSize}</div>
                  </div>
                  <i class="fas fa-hdd text-4xl text-blue-400"></i>
                </div>
              </div>
              
              <div class="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="text-sm text-gray-600 mb-1">総レコード数</div>
                    <div class="text-2xl font-bold text-green-600">${stats.mainDatabase.totalRows?.toLocaleString() || 0}</div>
                  </div>
                  <i class="fas fa-list text-4xl text-green-400"></i>
                </div>
              </div>
              
              <div class="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="text-sm text-gray-600 mb-1">接続数</div>
                    <div class="text-2xl font-bold text-purple-600">${connections.mainDatabase.totalConnections}</div>
                    <div class="text-xs text-gray-500 mt-1">アイドル: ${connections.mainDatabase.idleConnections}</div>
                  </div>
                  <i class="fas fa-plug text-4xl text-purple-400"></i>
                </div>
              </div>
            </div>

            <!-- Table Sizes -->
            <div class="mb-6">
              <h4 class="text-lg font-semibold text-gray-700 mb-3">
                <i class="fas fa-table mr-2"></i>テーブル別容量
              </h4>
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead class="bg-gray-100">
                    <tr>
                      <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">テーブル名</th>
                      <th class="px-4 py-3 text-right text-sm font-semibold text-gray-700">容量</th>
                      <th class="px-4 py-3 text-right text-sm font-semibold text-gray-700">割合</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200">
                    ${stats.mainDatabase.tables.map(table => {
                      const percentage = ((table.size_bytes / stats.mainDatabase.totalSizeBytes) * 100).toFixed(1);
                      return `
                        <tr class="hover:bg-gray-50">
                          <td class="px-4 py-3 text-sm font-medium text-gray-800">${table.tablename}</td>
                          <td class="px-4 py-3 text-sm text-right text-gray-600">${table.size}</td>
                          <td class="px-4 py-3 text-sm text-right">
                            <div class="flex items-center justify-end">
                              <div class="w-24 h-2 bg-gray-200 rounded-full mr-2">
                                <div class="h-2 bg-blue-500 rounded-full" style="width: ${percentage}%"></div>
                              </div>
                              <span class="text-gray-600">${percentage}%</span>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Row Counts -->
            <div>
              <h4 class="text-lg font-semibold text-gray-700 mb-3">
                <i class="fas fa-list-ol mr-2"></i>テーブル別レコード数
              </h4>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                ${stats.mainDatabase.rowCounts.map(row => `
                  <div class="bg-gray-50 rounded-lg p-3">
                    <div class="text-xs text-gray-600 mb-1">${row.table_name}</div>
                    <div class="text-xl font-bold text-gray-800">${parseInt(row.row_count).toLocaleString()}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          `}
        </div>

        <!-- Extension Database Stats -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h3 class="text-xl font-bold text-gray-800 mb-4">
            <i class="fas fa-server mr-2 text-purple-600"></i>延長管理データベース
          </h3>
          
          ${stats.extensionDatabase.error ? `
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">
              <i class="fas fa-info-circle mr-2"></i>${stats.extensionDatabase.error}
            </div>
          ` : `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div class="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="text-sm text-gray-600 mb-1">データベース容量</div>
                    <div class="text-2xl font-bold text-purple-600">${stats.extensionDatabase.totalSize}</div>
                  </div>
                  <i class="fas fa-hdd text-4xl text-purple-400"></i>
                </div>
              </div>
              
              <div class="bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg p-4">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="text-sm text-gray-600 mb-1">総レコード数</div>
                    <div class="text-2xl font-bold text-pink-600">${stats.extensionDatabase.totalRows?.toLocaleString() || 0}</div>
                  </div>
                  <i class="fas fa-list text-4xl text-pink-400"></i>
                </div>
              </div>
            </div>

            ${stats.extensionDatabase.tables && stats.extensionDatabase.tables.length > 0 ? `
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead class="bg-gray-100">
                    <tr>
                      <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">テーブル名</th>
                      <th class="px-4 py-3 text-right text-sm font-semibold text-gray-700">容量</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200">
                    ${stats.extensionDatabase.tables.map(table => `
                      <tr class="hover:bg-gray-50">
                        <td class="px-4 py-3 text-sm font-medium text-gray-800">${table.tablename}</td>
                        <td class="px-4 py-3 text-sm text-right text-gray-600">${table.size}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}
          `}
        </div>

        <!-- Performance Tips -->
        <div class="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-6">
          <h3 class="text-lg font-bold text-gray-800 mb-3">
            <i class="fas fa-lightbulb mr-2 text-yellow-600"></i>パフォーマンス改善のヒント
          </h3>
          <ul class="space-y-2 text-sm text-gray-700">
            <li class="flex items-start">
              <i class="fas fa-check-circle text-green-600 mr-2 mt-1"></i>
              <span>定期的に不要なデータを削除して容量を削減しましょう</span>
            </li>
            <li class="flex items-start">
              <i class="fas fa-check-circle text-green-600 mr-2 mt-1"></i>
              <span>インデックスが適切に設定されているか確認しましょう</span>
            </li>
            <li class="flex items-start">
              <i class="fas fa-check-circle text-green-600 mr-2 mt-1"></i>
              <span>接続プールの設定を最適化しましょう（現在: ${connections.mainDatabase.totalConnections}接続）</span>
            </li>
            <li class="flex items-start">
              <i class="fas fa-check-circle text-green-600 mr-2 mt-1"></i>
              <span>大量データ取得時はページネーションを活用しましょう</span>
            </li>
          </ul>
        </div>
      </div>
    `;

  } catch (error) {
    console.error('Error loading database page:', error);
    
    content.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <i class="fas fa-exclamation-triangle text-4xl text-red-600 mb-4"></i>
        <h3 class="text-xl font-bold text-red-800 mb-2">エラーが発生しました</h3>
        <p class="text-red-600 mb-2">${error.message}</p>
        <p class="text-sm text-red-500 mt-2">データベース情報の取得に失敗しました。</p>
      </div>
    `;
  }
}


// ===========================================
// Broadcast Helper Functions
// ===========================================

/**
 * Show modal dialog
 */
function showModal(content) {
  const modalHtml = `
    <div id="broadcast-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center" onclick="if(event.target.id === 'broadcast-modal') closeModal()">
      <div class="relative bg-white rounded-lg shadow-xl max-w-2xl w-full m-4 p-6" onclick="event.stopPropagation()">
        ${content}
      </div>
    </div>
  `;
  
  // Remove existing modal if any
  const existingModal = document.getElementById('broadcast-modal');
  if (existingModal) {
    existingModal.remove();
  }
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Close modal dialog
 */
function closeModal() {
  const modal = document.getElementById('broadcast-modal');
  if (modal) {
    modal.remove();
  }
}

/**
 * Show notification toast
 */
function showNotification(message, type = 'info') {
  const colors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    warning: 'bg-yellow-600',
    info: 'bg-blue-600'
  };
  
  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle'
  };
  
  const notificationHtml = `
    <div id="broadcast-notification" class="${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg fixed top-4 right-4 z-50 flex items-center gap-3 animate-fade-in">
      <i class="fas ${icons[type]}"></i>
      <span>${message}</span>
    </div>
  `;
  
  // Remove existing notification if any
  const existingNotification = document.getElementById('broadcast-notification');
  if (existingNotification) {
    existingNotification.remove();
  }
  
  document.body.insertAdjacentHTML('beforeend', notificationHtml);
  
  // Auto remove after 3 seconds
  setTimeout(() => {
    const notification = document.getElementById('broadcast-notification');
    if (notification) {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }
  }, 3000);
}

// Run database migration
async function runDatabaseMigration() {
  if (!confirm('データベースマイグレーションを実行しますか？\n\nこの操作により、不足しているテーブルやカラムが作成されます。')) {
    return;
  }
  
  try {
    console.log('🔄 Starting migration...');
    showNotification('マイグレーションを実行中...', 'info');
    
    const response = await axios.post(`${API_BASE}/api/database/migrate`, {}, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    
    console.log('Migration response:', response.data);
    
    if (response.data.success) {
      const lessonReportsExists = response.data.lessonReportsTableExists;
      console.log(`lesson_reports table exists: ${lessonReportsExists}`);
      
      showNotification(
        `✅ マイグレーションが完了しました\nlesson_reportsテーブル: ${lessonReportsExists ? '作成済み' : '未作成'}`,
        'success'
      );
      
      // Check all tables
      const tablesResponse = await axios.get(`${API_BASE}/api/database/tables`);
      console.log('All tables:', tablesResponse.data.tables);
      
      // Reload the database page
      setTimeout(() => {
        renderDatabasePage();
      }, 1000);
    } else {
      throw new Error(response.data.error);
    }
  } catch (error) {
    console.error('Migration error:', error);
    console.error('Error response:', error.response?.data);
    showNotification(
      '❌ マイグレーション実行エラー: ' + (error.response?.data?.error || error.message),
      'error'
    );
  }
}

// ===========================================
// Broadcast Functions
// ===========================================

// Broadcast state
let broadcastTutors = [];
let broadcastTemplates = [];
let broadcastLogs = [];

/**
 * Render Broadcast Page
 */
async function renderBroadcastPage() {
  document.getElementById('content').innerHTML = `
    <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-8">
      <div class="max-w-7xl mx-auto">
        <div class="flex justify-between items-center mb-8">
          <div>
            <h1 class="text-4xl font-bold text-blue-900 mb-2">
              <i class="fas fa-bullhorn mr-3 text-blue-600"></i>一斉送信
            </h1>
            <p class="text-gray-600">Discord一斉送信メッセージ管理</p>
          </div>
          <button onclick="showTemplatesModal()" class="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition">
            <i class="fas fa-folder-open mr-2"></i>テンプレート管理
          </button>
        </div>
        
        <!-- Broadcast Form -->
        <div class="bg-white rounded-xl shadow-md p-6 mb-6">
          <h2 class="text-xl font-bold text-gray-800 mb-4">
            <i class="fas fa-paper-plane mr-2 text-blue-600"></i>メッセージ送信
          </h2>
          
          <!-- Target Settings -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">
                <i class="fas fa-users mr-1"></i>送信対象
              </label>
              <select id="broadcast-target-status" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="アクティブ">アクティブ生徒のみ</option>
                <option value="レッスン中">レッスン中（永久会員・在籍プラン除く）</option>
                <option value="レッスン準備中">レッスン準備中</option>
                <option value="休会">休会中</option>
              </select>
            </div>
            
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">
                <i class="fas fa-chalkboard-teacher mr-1"></i>担当Tutor
              </label>
              <select id="broadcast-target-tutor" onchange="updatePreviewCount()" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="all">全てのTutor</option>
              </select>
            </div>
          </div>
          
          <div class="mb-4">
            <label class="block text-sm font-semibold text-gray-700 mb-2">
              <i class="fas fa-hashtag mr-1"></i>送信先チャンネル
            </label>
            <select id="broadcast-channel-type" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              <option value="notice">お知らせ</option>
              <option value="tips">お役立ち情報</option>
              <option value="chat">チャット</option>
            </select>
          </div>
          
          <div class="mb-4">
            <label class="block text-sm font-semibold text-gray-700 mb-2">
              <i class="fas fa-comment-alt mr-1"></i>メッセージ内容
            </label>
            <textarea id="broadcast-content" rows="6" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="送信するメッセージを入力してください..."></textarea>
          </div>
          
          <div class="mb-4">
            <label class="block text-sm font-semibold text-gray-700 mb-2">
              <i class="fas fa-image mr-1"></i>添付画像（任意）
            </label>
            
            <!-- Image Upload Section -->
            <div class="border-2 border-dashed border-gray-300 rounded-lg p-4 bg-gray-50">
              <!-- File Input -->
              <input type="file" id="broadcast-image-file" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp" class="hidden" onchange="handleImageUpload(event)">
              
              <!-- Upload Button -->
              <button type="button" onclick="document.getElementById('broadcast-image-file').click()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition mb-2">
                <i class="fas fa-upload mr-2"></i>画像をアップロード
              </button>
              
              <p class="text-xs text-gray-500 mb-2">対応形式: JPEG, PNG, GIF, WebP（最大8MB）</p>
              
              <!-- Image Preview -->
              <div id="broadcast-image-preview" class="hidden mt-3">
                <img id="broadcast-image-preview-img" src="" alt="Preview" class="max-w-full max-h-48 rounded border border-gray-300">
                <button type="button" onclick="removeImagePreview()" class="mt-2 text-red-600 hover:text-red-800 text-sm">
                  <i class="fas fa-times mr-1"></i>画像を削除
                </button>
              </div>
              
              <!-- Upload Status -->
              <div id="broadcast-image-upload-status" class="hidden mt-2"></div>
              
              <!-- Hidden field for image URL -->
              <input type="hidden" id="broadcast-image-url">
            </div>
            
            <!-- Discord Markdown Help -->
            <div class="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p class="text-sm font-semibold text-blue-900 mb-2">
                <i class="fas fa-info-circle mr-1"></i>Discord マークダウン対応
              </p>
              <div class="text-xs text-gray-700 space-y-1">
                <p><code class="bg-white px-1 rounded">**太字**</code> → <strong>太字</strong></p>
                <p><code class="bg-white px-1 rounded">*斜体*</code> → <em>斜体</em></p>
                <p><code class="bg-white px-1 rounded">__下線__</code> → <u>下線</u></p>
                <p><code class="bg-white px-1 rounded">~~取り消し線~~</code> → <del>取り消し線</del></p>
                <p><code class="bg-white px-1 rounded"># 見出し1</code> → 大きな見出し</p>
                <p><code class="bg-white px-1 rounded">## 見出し2</code> → 中くらいの見出し</p>
                <p><code class="bg-white px-1 rounded">### 見出し3</code> → 小さな見出し</p>
              </div>
            </div>
          </div>
          
          <!-- Preview Section -->
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <h3 class="text-sm font-bold text-blue-900 mb-2">
              <i class="fas fa-eye mr-2"></i>送信先プレビュー
            </h3>
            <p id="preview-count" class="text-gray-700">
              <i class="fas fa-spinner fa-spin mr-2"></i>読み込み中...
            </p>
          </div>
          
          <!-- Action Buttons -->
          <div class="flex gap-3">
            <button onclick="previewBroadcast()" class="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition font-semibold">
              <i class="fas fa-eye mr-2"></i>送信先を確認
            </button>
            <button onclick="sendBroadcast()" class="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition font-semibold">
              <i class="fas fa-paper-plane mr-2"></i>送信
            </button>
            <button onclick="saveTemplate()" class="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition font-semibold">
              <i class="fas fa-save mr-2"></i>テンプレート保存
            </button>
          </div>
        </div>
        
        <!-- Schedule Management Section -->
        <div class="bg-white rounded-xl shadow-md p-6 mb-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold text-gray-800">
              <i class="fas fa-clock mr-2 text-purple-600"></i>定期送信スケジュール
            </h2>
            <button onclick="showScheduleModal()" class="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition">
              <i class="fas fa-plus mr-2"></i>新規スケジュール
            </button>
          </div>
          <div id="schedule-list-container">
            <p class="text-gray-500 text-center py-8">
              <i class="fas fa-spinner fa-spin mr-2"></i>スケジュールを読み込み中...
            </p>
          </div>
        </div>
        
        <!-- Logs Section -->
        <div class="bg-white rounded-xl shadow-md p-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold text-gray-800">
              <i class="fas fa-history mr-2 text-blue-600"></i>送信履歴
            </h2>
            <button onclick="loadBroadcastLogs()" class="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition">
              <i class="fas fa-sync-alt mr-2"></i>更新
            </button>
          </div>
          <div id="broadcast-logs-container">
            <p class="text-gray-500 text-center py-8">
              <i class="fas fa-inbox mr-2"></i>送信履歴を読み込み中...
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Load tutors and initial preview
  await loadBroadcastTutors();
  await updatePreviewCount();
  await loadSchedules();
  await loadBroadcastLogs();
}

/**
 * Load tutors for filtering
 */
async function loadBroadcastTutors() {
  try {
    const response = await axios.get(`${API_BASE}/api/broadcast/tutors`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      broadcastTutors = response.data.tutors;
      
      const selectElement = document.getElementById('broadcast-target-tutor');
      if (selectElement) {
        // Add test option first
        const testOption = document.createElement('option');
        testOption.value = 'test';
        testOption.textContent = '🧪 テスト送信';
        testOption.style.backgroundColor = '#FEF3C7';
        testOption.style.fontWeight = 'bold';
        selectElement.appendChild(testOption);
        
        // Add separator
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '──────────────';
        selectElement.appendChild(separator);
        
        // Add tutor options
        broadcastTutors.forEach(tutor => {
          const option = document.createElement('option');
          option.value = tutor.notion_name;
          option.textContent = tutor.notion_name;
          selectElement.appendChild(option);
        });
        
        // If crew role, disable "all" option
        if (currentUser.role === 'crew') {
          selectElement.querySelector('option[value="all"]').disabled = true;
          selectElement.selectedIndex = 3; // Select first tutor (after test and separator)
        }
      }
    }
  } catch (error) {
    console.error('Error loading tutors:', error);
    showNotification('Tutor一覧の取得に失敗しました', 'error');
  }
}

/**
 * Update preview count
 */
async function updatePreviewCount() {
  const targetStatus = document.getElementById('broadcast-target-status')?.value || 'アクティブ';
  const targetTutor = document.getElementById('broadcast-target-tutor')?.value || 'all';
  const previewElement = document.getElementById('preview-count');
  
  if (!previewElement) return;
  
  // Handle test mode
  if (targetTutor === 'test') {
    previewElement.innerHTML = `
      <i class="fas fa-flask mr-2 text-yellow-600"></i>
      <span class="font-bold text-xl text-yellow-900">テスト送信モード</span>
      <span class="text-sm text-gray-600 ml-2">（テスト用Webhookに送信されます）</span>
    `;
    return;
  }
  
  previewElement.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>読み込み中...';
  
  try {
    const response = await axios.post(`${API_BASE}/api/broadcast/preview`, {
      targetStatus,
      targetTutor: targetTutor === 'all' ? null : targetTutor
    }, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      const count = response.data.count;
      previewElement.innerHTML = `
        <i class="fas fa-check-circle mr-2 text-green-600"></i>
        <span class="font-bold text-2xl text-blue-900">${count}</span>名の生徒に送信されます
      `;
    }
  } catch (error) {
    console.error('Error getting preview:', error);
    previewElement.innerHTML = '<i class="fas fa-exclamation-triangle mr-2 text-red-600"></i>プレビューの取得に失敗しました';
  }
}

/**
 * Preview broadcast targets
 */
async function previewBroadcast() {
  const targetStatus = document.getElementById('broadcast-target-status').value;
  const targetTutor = document.getElementById('broadcast-target-tutor').value;
  
  // Handle test mode
  if (targetTutor === 'test') {
    showModal(`
      <h2 class="text-2xl font-bold mb-4">
        <i class="fas fa-flask mr-2 text-yellow-600"></i>テスト送信プレビュー
      </h2>
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
        <p class="text-yellow-800 font-semibold mb-2">
          <i class="fas fa-info-circle mr-2"></i>テストモード
        </p>
        <p class="text-sm text-gray-700 mb-2">
          以下のテスト用Webhookに送信されます：
        </p>
        <div class="bg-white rounded p-3 text-xs font-mono break-all text-gray-600">
          https://discord.com/api/webhooks/1282616705817903146/M4KSU...
        </div>
        <p class="text-sm text-gray-700 mt-2">
          <i class="fas fa-user mr-1"></i>メンション: <code class="bg-white px-2 py-1 rounded">@766666980086120470</code>
        </p>
      </div>
      <div class="mt-4 flex gap-3">
        <button onclick="closeModal()" class="flex-1 bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 transition">
          閉じる
        </button>
        <button onclick="closeModal(); sendBroadcast();" class="flex-1 bg-yellow-600 text-white px-6 py-3 rounded-lg hover:bg-yellow-700 transition">
          <i class="fas fa-flask mr-2"></i>テスト送信
        </button>
      </div>
    `);
    return;
  }
  
  try {
    const response = await axios.post(`${API_BASE}/api/broadcast/preview`, {
      targetStatus,
      targetTutor: targetTutor === 'all' ? null : targetTutor
    }, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      const students = response.data.students;
      
      // Show modal with student list
      const studentListHtml = students.map(s => `
        <div class="flex items-center justify-between py-2 px-3 hover:bg-gray-50 rounded">
          <div>
            <span class="font-semibold">${s.name}</span>
            <span class="text-gray-500 text-sm ml-2">(${s.student_id})</span>
          </div>
          <div class="text-sm text-gray-600">
            <i class="fas fa-chalkboard-teacher mr-1"></i>${s.homeroom_tutor}
          </div>
        </div>
      `).join('');
      
      showModal(`
        <h2 class="text-2xl font-bold mb-4">
          <i class="fas fa-users mr-2 text-blue-600"></i>送信先プレビュー
        </h2>
        <p class="text-gray-700 mb-4">
          以下の<span class="font-bold text-blue-900 text-xl">${students.length}名</span>の生徒に送信されます：
        </p>
        <div class="max-h-96 overflow-y-auto border border-gray-200 rounded-lg p-2">
          ${studentListHtml}
        </div>
        <div class="mt-4 flex gap-3">
          <button onclick="closeModal()" class="flex-1 bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 transition">
            閉じる
          </button>
          <button onclick="closeModal(); sendBroadcast();" class="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition">
            <i class="fas fa-paper-plane mr-2"></i>この内容で送信
          </button>
        </div>
      `);
    }
  } catch (error) {
    console.error('Error previewing broadcast:', error);
    showNotification('プレビューの取得に失敗しました', 'error');
  }
}

/**
 * Send broadcast message
 */
async function sendBroadcast() {
  const content = document.getElementById('broadcast-content').value.trim();
  const imageId = document.getElementById('broadcast-image-url').value.trim();
  const channelType = document.getElementById('broadcast-channel-type').value;
  const targetStatus = document.getElementById('broadcast-target-status').value;
  const targetTutor = document.getElementById('broadcast-target-tutor').value;
  
  console.log('[Frontend] sendBroadcast called with:', {
    hasContent: !!content,
    hasImageId: !!imageId,
    imageId: imageId || 'none',
    channelType,
    targetStatus,
    targetTutor
  });
  
  if (!content) {
    showNotification('メッセージ内容を入力してください', 'error');
    return;
  }
  
  // Confirm
  if (!confirm('メッセージを送信しますか？\nこの操作は取り消せません。')) {
    return;
  }
  
  try {
    showNotification('送信中...', 'info');
    
    const isTest = targetTutor === 'test';
    
    const requestData = {
      content,
      imageId: imageId || null,
      channelType,
      targetStatus,
      targetTutor: (targetTutor === 'all' || targetTutor === 'test') ? null : targetTutor,
      name: isTest ? `Test Broadcast ${new Date().toLocaleString('ja-JP')}` : `Broadcast ${new Date().toLocaleString('ja-JP')}`,
      saveAsTemplate: false,
      isTest: isTest
    };
    
    console.log('[Frontend] Sending request data:', requestData);
    
    const response = await axios.post(`${API_BASE}/api/broadcast/send`, requestData, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      const message = isTest 
        ? '✅ テスト送信が完了しました' 
        : `✅ ${response.data.results.sent}/${response.data.results.total}件 送信完了`;
      showNotification(message, 'success');
      
      // Reload logs
      await loadBroadcastLogs();
      
      // Show detailed results
      if (response.data.results.failed > 0) {
        showModal(`
          <h2 class="text-2xl font-bold mb-4">
            <i class="fas fa-info-circle mr-2 text-yellow-600"></i>送信結果
          </h2>
          <div class="space-y-3">
            <p class="text-lg">
              <span class="text-green-600 font-bold">${response.data.results.sent}件</span> 送信成功
            </p>
            <p class="text-lg">
              <span class="text-red-600 font-bold">${response.data.results.failed}件</span> 送信失敗
            </p>
            <p class="text-sm text-gray-600 mt-4">
              詳細は送信履歴をご確認ください。
            </p>
          </div>
          <button onclick="closeModal()" class="mt-4 w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition">
            閉じる
          </button>
        `);
      }
    }
  } catch (error) {
    console.error('Error sending broadcast:', error);
    showNotification('送信に失敗しました: ' + (error.response?.data?.error || error.message), 'error');
  }
}

/**
 * Save as template
 */
async function saveTemplate() {
  const content = document.getElementById('broadcast-content').value.trim();
  const imageId = document.getElementById('broadcast-image-url').value.trim();
  const channelType = document.getElementById('broadcast-channel-type').value;
  const targetTutor = document.getElementById('broadcast-target-tutor').value;
  
  if (!content) {
    showNotification('メッセージ内容を入力してください', 'error');
    return;
  }
  
  const name = prompt('テンプレート名を入力してください:');
  if (!name) return;
  
  try {
    const response = await axios.post(`${API_BASE}/api/broadcast/templates`, {
      name,
      content,
      imageUrl: imageId || null,  // Send imageId as imageUrl for now
      channelType,
      targetTutor: targetTutor === 'all' ? null : targetTutor
    }, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      showNotification('✅ テンプレートを保存しました', 'success');
    }
  } catch (error) {
    console.error('Error saving template:', error);
    showNotification('テンプレートの保存に失敗しました', 'error');
  }
}

/**
 * Show templates modal
 */
async function showTemplatesModal() {
  try {
    const response = await axios.get(`${API_BASE}/api/broadcast/templates`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      broadcastTemplates = response.data.templates;
      
      const templatesHtml = broadcastTemplates.length === 0 ? `
        <p class="text-gray-500 text-center py-8">
          <i class="fas fa-inbox mr-2"></i>テンプレートがありません
        </p>
      ` : broadcastTemplates.map(t => `
        <div class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition">
          <div class="flex justify-between items-start mb-2">
            <h3 class="font-bold text-lg text-gray-800">${t.name}</h3>
            <div class="flex gap-2">
              <button onclick="loadTemplate(${t.id})" class="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition text-sm">
                <i class="fas fa-download mr-1"></i>読込
              </button>
              <button onclick="deleteTemplate(${t.id})" class="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition text-sm">
                <i class="fas fa-trash mr-1"></i>削除
              </button>
            </div>
          </div>
          <p class="text-gray-700 text-sm mb-2 whitespace-pre-wrap">${t.content}</p>
          <div class="flex gap-4 text-xs text-gray-500">
            <span><i class="fas fa-hashtag mr-1"></i>${t.channel_type}</span>
            ${t.target_tutor ? `<span><i class="fas fa-chalkboard-teacher mr-1"></i>${t.target_tutor}</span>` : ''}
            ${t.image_url ? '<span><i class="fas fa-image mr-1"></i>画像あり</span>' : ''}
          </div>
        </div>
      `).join('');
      
      showModal(`
        <h2 class="text-2xl font-bold mb-4">
          <i class="fas fa-folder-open mr-2 text-indigo-600"></i>テンプレート管理
        </h2>
        <div class="max-h-96 overflow-y-auto space-y-3">
          ${templatesHtml}
        </div>
        <button onclick="closeModal()" class="mt-4 w-full bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition">
          閉じる
        </button>
      `);
    }
  } catch (error) {
    console.error('Error loading templates:', error);
    showNotification('テンプレートの取得に失敗しました', 'error');
  }
}

/**
 * Load template into form
 */
function loadTemplate(templateId) {
  const template = broadcastTemplates.find(t => t.id === templateId);
  if (!template) return;
  
  document.getElementById('broadcast-content').value = template.content;
  document.getElementById('broadcast-channel-type').value = template.channel_type;
  
  // Load image if exists
  if (template.image_url) {
    const imageId = template.image_url;
    document.getElementById('broadcast-image-url').value = imageId;
    
    // Show image preview from server
    const previewImg = document.getElementById('broadcast-image-preview-img');
    previewImg.src = `${API_BASE}/api/broadcast/images/${imageId}`;
    document.getElementById('broadcast-image-preview').classList.remove('hidden');
    
    // Show upload status message
    const statusElement = document.getElementById('broadcast-image-upload-status');
    statusElement.className = 'mt-2 text-green-600';
    statusElement.innerHTML = '<i class="fas fa-check-circle mr-2"></i>画像を読み込みました';
    statusElement.classList.remove('hidden');
  } else {
    // Clear image
    document.getElementById('broadcast-image-url').value = '';
    document.getElementById('broadcast-image-preview').classList.add('hidden');
    document.getElementById('broadcast-image-upload-status').classList.add('hidden');
  }
  
  if (template.target_tutor) {
    document.getElementById('broadcast-target-tutor').value = template.target_tutor;
  }
  
  closeModal();
  updatePreviewCount();
  showNotification('✅ テンプレートを読み込みました', 'success');
}

/**
 * Delete template
 */
async function deleteTemplate(templateId) {
  if (!confirm('このテンプレートを削除しますか？')) {
    return;
  }
  
  try {
    const response = await axios.delete(`${API_BASE}/api/broadcast/templates/${templateId}`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      showNotification('✅ テンプレートを削除しました', 'success');
      showTemplatesModal(); // Reload modal
    }
  } catch (error) {
    console.error('Error deleting template:', error);
    showNotification('テンプレートの削除に失敗しました', 'error');
  }
}

/**
 * Load broadcast logs
 */
async function loadBroadcastLogs() {
  try {
    const response = await axios.get(`${API_BASE}/api/broadcast/logs?limit=50`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      broadcastLogs = response.data.logs;
      renderBroadcastLogs();
    }
  } catch (error) {
    console.error('Error loading logs:', error);
    const container = document.getElementById('broadcast-logs-container');
    if (container) {
      container.innerHTML = `
        <p class="text-red-600 text-center py-8">
          <i class="fas fa-exclamation-triangle mr-2"></i>送信履歴の取得に失敗しました
        </p>
      `;
    }
  }
}

/**
 * Render broadcast logs
 */
function renderBroadcastLogs() {
  const container = document.getElementById('broadcast-logs-container');
  if (!container) return;
  
  if (broadcastLogs.length === 0) {
    container.innerHTML = `
      <p class="text-gray-500 text-center py-8">
        <i class="fas fa-inbox mr-2"></i>送信履歴がありません
      </p>
    `;
    return;
  }
  
  // Group logs by broadcast_message_id
  const groupedLogs = {};
  broadcastLogs.forEach(log => {
    if (!groupedLogs[log.broadcast_message_id]) {
      groupedLogs[log.broadcast_message_id] = [];
    }
    groupedLogs[log.broadcast_message_id].push(log);
  });
  
  const logsHtml = Object.entries(groupedLogs).map(([broadcastId, logs]) => {
    const firstLog = logs[0];
    const successCount = logs.filter(l => l.status === 'sent').length;
    const failCount = logs.filter(l => l.status === 'failed').length;
    const totalCount = logs.length;
    
    return `
      <div class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition">
        <div class="flex justify-between items-start mb-2">
          <div>
            <h3 class="font-bold text-gray-800">${firstLog.message_name || 'Broadcast ' + broadcastId}</h3>
            <p class="text-sm text-gray-600">
              <i class="fas fa-clock mr-1"></i>${new Date(firstLog.sent_at).toLocaleString('ja-JP')}
            </p>
          </div>
          <div class="flex gap-2 items-center">
            <span class="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-semibold">
              <i class="fas fa-check mr-1"></i>${successCount}
            </span>
            ${failCount > 0 ? `
              <span class="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-semibold">
                <i class="fas fa-times mr-1"></i>${failCount}
              </span>
            ` : ''}
          </div>
        </div>
        <div class="flex gap-2 text-xs text-gray-500">
          <span><i class="fas fa-hashtag mr-1"></i>${firstLog.channel_type}</span>
          <span><i class="fas fa-users mr-1"></i>${totalCount}名</span>
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = logsHtml;
}

/**
 * Handle image upload
 */
async function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // Validate file size (max 8MB)
  if (file.size > 8 * 1024 * 1024) {
    showNotification('画像ファイルが大きすぎます（最大8MB）', 'error');
    return;
  }
  
  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    showNotification('対応していないファイル形式です', 'error');
    return;
  }
  
  // Show upload status
  const statusElement = document.getElementById('broadcast-image-upload-status');
  statusElement.className = 'mt-2 text-blue-600';
  statusElement.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>アップロード中...';
  statusElement.classList.remove('hidden');
  
  try {
    // Create FormData
    const formData = new FormData();
    formData.append('image', file);
    
    // Upload to server
    const response = await axios.post(`${API_BASE}/api/broadcast/upload-image`, formData, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'multipart/form-data'
      }
    });
    
    if (response.data.success) {
      const imageId = response.data.imageId;
      const filename = response.data.filename;
      
      // Store imageId in hidden field
      document.getElementById('broadcast-image-url').value = imageId;
      
      // Show preview using a placeholder or local object URL
      const previewImg = document.getElementById('broadcast-image-preview-img');
      
      // Create object URL for preview
      const objectUrl = URL.createObjectURL(file);
      previewImg.src = objectUrl;
      document.getElementById('broadcast-image-preview').classList.remove('hidden');
      
      // Update status
      statusElement.className = 'mt-2 text-green-600';
      statusElement.innerHTML = `<i class="fas fa-check-circle mr-2"></i>アップロード完了: ${filename}`;
      
      showNotification('✅ 画像をアップロードしました', 'success');
    } else {
      throw new Error(response.data.error || 'Upload failed');
    }
  } catch (error) {
    console.error('Error uploading image:', error);
    console.error('Error details:', error.response?.data);
    
    const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
    
    statusElement.className = 'mt-2 text-red-600';
    statusElement.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i>アップロード失敗: ${errorMessage}`;
    showNotification(`画像のアップロードに失敗しました: ${errorMessage}`, 'error');
  }
}

/**
 * Remove image preview
 */
function removeImagePreview() {
  document.getElementById('broadcast-image-url').value = '';
  document.getElementById('broadcast-image-file').value = '';
  document.getElementById('broadcast-image-preview').classList.add('hidden');
  document.getElementById('broadcast-image-upload-status').classList.add('hidden');
  showNotification('画像を削除しました', 'info');
}

// ===========================================
// Schedule Functions
// ===========================================

/**
 * Load all schedules
 */
async function loadSchedules() {
  try {
    const response = await axios.get(`${API_BASE}/api/broadcast/schedules`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      broadcastSchedules = response.data.schedules;
      renderScheduleList(broadcastSchedules);
    }
  } catch (error) {
    console.error('Error loading schedules:', error);
    const errorMessage = error.response?.data?.error || error.message || '不明なエラー';
    document.getElementById('schedule-list-container').innerHTML = `
      <p class="text-red-600 text-center py-8">
        <i class="fas fa-exclamation-triangle mr-2"></i>スケジュールの取得に失敗しました
      </p>
      <p class="text-xs text-gray-600 text-center">
        エラー詳細: ${errorMessage}
      </p>
    `;
  }
}

/**
 * Render schedule list
 */
function renderScheduleList(schedules) {
  const container = document.getElementById('schedule-list-container');
  
  if (schedules.length === 0) {
    container.innerHTML = `
      <p class="text-gray-500 text-center py-8">
        <i class="fas fa-inbox mr-2"></i>スケジュールがありません
      </p>
    `;
    return;
  }
  
  const schedulesHtml = schedules.map(schedule => {
    const enabled = schedule.schedule_enabled;
    const statusBadge = enabled 
      ? '<span class="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-semibold">有効</span>'
      : '<span class="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs font-semibold">無効</span>';
    
    // Parse cron expression
    const cronParts = schedule.schedule_cron.split(' ');
    const minute = cronParts[0];
    const hour = cronParts[1];
    const dayOfWeek = cronParts[4];
    
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const dayName = dayNames[parseInt(dayOfWeek)] || '毎日';
    const timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    
    let frequencyStr = '毎週';
    if (cronParts[2] === '1-7') {
      frequencyStr = '毎月第1';
    } else if (schedule.schedule_cron.includes('biweekly')) {
      frequencyStr = '2週間ごとの';
    }
    
    const scheduleStr = `${frequencyStr}${dayName}曜日 ${timeStr}`;
    
    const lastSent = schedule.last_sent_at 
      ? new Date(schedule.last_sent_at).toLocaleString('ja-JP')
      : '未送信';
    
    return `
      <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
        <div class="flex justify-between items-start mb-2">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <h3 class="text-lg font-semibold text-gray-800">${schedule.name}</h3>
              ${statusBadge}
            </div>
            <p class="text-sm text-purple-600 mb-1">
              <i class="fas fa-clock mr-1"></i>${scheduleStr}
            </p>
            <p class="text-xs text-gray-600 mb-2">
              <i class="fas fa-hashtag mr-1"></i>${schedule.channel_type} | 
              <i class="fas fa-users mr-1"></i>${schedule.target_status} | 
              <i class="fas fa-chalkboard-teacher mr-1"></i>${schedule.target_tutor || '全て'}
              ${schedule.image_url ? ' | <i class="fas fa-image text-purple-600 mr-1"></i>画像あり' : ''}
            </p>
            <p class="text-sm text-gray-700 line-clamp-2">${schedule.content}</p>
            <p class="text-xs text-gray-500 mt-2">
              最終送信: ${lastSent}
            </p>
          </div>
          <div class="flex flex-col gap-2 ml-4">
            <button onclick="toggleSchedule(${schedule.id})" class="px-3 py-1 rounded ${enabled ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-500 hover:bg-green-600'} text-white text-xs transition">
              <i class="fas fa-${enabled ? 'pause' : 'play'} mr-1"></i>${enabled ? '無効化' : '有効化'}
            </button>
            <button onclick="editSchedule(${schedule.id})" class="px-3 py-1 rounded bg-blue-500 hover:bg-blue-600 text-white text-xs transition">
              <i class="fas fa-edit mr-1"></i>編集
            </button>
            <button onclick="deleteSchedule(${schedule.id})" class="px-3 py-1 rounded bg-red-500 hover:bg-red-600 text-white text-xs transition">
              <i class="fas fa-trash mr-1"></i>削除
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = `<div class="space-y-3">${schedulesHtml}</div>`;
}

/**
 * Show schedule modal
 */
/**
 * Show schedule modal
 */
function showScheduleModal(scheduleId = null) {
  const schedule = scheduleId ? broadcastSchedules.find(s => s.id === scheduleId) : null;
  
  // Helper function to generate 30-minute interval time options
  const generateTimeOptions = () => {
    let options = '';
    for (let hour = 0; hour < 24; hour++) {
      for (let minute of [0, 30]) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const selected = schedule && schedule.schedule_time === timeStr ? 'selected' : 
                        (!schedule && timeStr === '17:00' ? 'selected' : '');
        options += `<option value="${timeStr}" ${selected}>${timeStr}</option>`;
      }
    }
    return options;
  };
  
  const modalContent = `
    <div class="max-w-2xl mx-auto">
      <h2 class="text-2xl font-bold mb-6">
        <i class="fas fa-clock mr-2 text-purple-600"></i>${schedule ? 'スケジュール編集' : '新規スケジュール作成'}
      </h2>
      
      <div class="space-y-4">
        <!-- Name -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-tag mr-1"></i>スケジュール名
          </label>
          <input type="text" id="schedule-name" value="${schedule ? schedule.name : ''}" placeholder="例: 毎週金曜日のお知らせ" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
        </div>
        
        <!-- Frequency -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-repeat mr-1"></i>頻度
          </label>
          <select id="schedule-frequency" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
            <option value="weekly">毎週</option>
            <option value="biweekly">2週間ごと</option>
            <option value="monthly">毎月第1</option>
          </select>
        </div>
        
        <!-- Day of Week -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-calendar-day mr-1"></i>曜日
          </label>
          <select id="schedule-day" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
            <option value="0">日曜日</option>
            <option value="1">月曜日</option>
            <option value="2">火曜日</option>
            <option value="3">水曜日</option>
            <option value="4">木曜日</option>
            <option value="5" selected>金曜日</option>
            <option value="6">土曜日</option>
          </select>
        </div>
        
        <!-- Time -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-clock mr-1"></i>時刻（30分単位）
          </label>
          <select id="schedule-time" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
            ${generateTimeOptions()}
          </select>
          <p class="text-xs text-gray-500 mt-1">
            <i class="fas fa-info-circle mr-1"></i>スケジュールチェックは30分ごとに実行されます
          </p>
        </div>
        
        <!-- Target Status -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-users mr-1"></i>送信対象
          </label>
          <select id="schedule-target-status" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
            <option value="アクティブ">アクティブ生徒のみ</option>
            <option value="レッスン中">レッスン中（永久会員・在籍プラン除く）</option>
            <option value="レッスン準備中">レッスン準備中</option>
            <option value="休会">休会中</option>
          </select>
        </div>
        
        <!-- Target Tutor -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-chalkboard-teacher mr-1"></i>担当Tutor
          </label>
          <select id="schedule-target-tutor" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
            <option value="">全てのTutor</option>
          </select>
        </div>
        
        <!-- Channel Type -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-hashtag mr-1"></i>送信先チャンネル
          </label>
          <select id="schedule-channel-type" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
            <option value="notice">お知らせ</option>
            <option value="tips">お役立ち情報</option>
            <option value="chat">チャット</option>
          </select>
        </div>
        
        <!-- Content -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-comment-alt mr-1"></i>メッセージ内容
          </label>
          <textarea id="schedule-content" rows="4" placeholder="送信するメッセージを入力してください..." class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">${schedule ? schedule.content : ''}</textarea>
        </div>
        
        <!-- Image Upload for Schedule -->
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-image mr-1"></i>添付画像（任意）
          </label>
          <div class="border-2 border-dashed border-gray-300 rounded-lg p-4 bg-gray-50">
            <input type="file" id="schedule-image-file" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp" class="hidden" onchange="handleScheduleImageUpload(event)">
            <button type="button" onclick="document.getElementById('schedule-image-file').click()" class="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition mb-2">
              <i class="fas fa-upload mr-2"></i>画像をアップロード
            </button>
            <p class="text-xs text-gray-500 mb-2">対応形式: JPEG, PNG, GIF, WebP（最大8MB）</p>
            <div id="schedule-image-preview" class="hidden mt-3">
              <img id="schedule-image-preview-img" src="" alt="Preview" class="max-w-full max-h-48 rounded border border-gray-300">
              <button type="button" onclick="removeScheduleImagePreview()" class="mt-2 text-red-600 hover:text-red-800 text-sm">
                <i class="fas fa-times mr-1"></i>画像を削除
              </button>
            </div>
            <div id="schedule-image-upload-status" class="hidden mt-2"></div>
            <input type="hidden" id="schedule-image-id">
          </div>
        </div>
        
        <!-- Enabled -->
        <div class="flex items-center">
          <input type="checkbox" id="schedule-enabled" ${schedule ? (schedule.schedule_enabled ? 'checked' : '') : 'checked'} class="mr-2 w-4 h-4 text-purple-600 focus:ring-purple-500">
          <label for="schedule-enabled" class="text-sm font-semibold text-gray-700">
            スケジュールを有効にする
          </label>
        </div>
      </div>
      
      <div class="mt-6 flex gap-3">
        <button onclick="closeModal()" class="flex-1 bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 transition">
          <i class="fas fa-times mr-2"></i>キャンセル
        </button>
        <button onclick="saveSchedule(${scheduleId})" class="flex-1 bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition">
          <i class="fas fa-save mr-2"></i>保存
        </button>
      </div>
    </div>
  `;
  
  showModal(modalContent);
  
  // Load tutors for selector
  if (broadcastTutors && broadcastTutors.length > 0) {
    const tutorSelect = document.getElementById('schedule-target-tutor');
    broadcastTutors.forEach(tutor => {
      const option = document.createElement('option');
      option.value = tutor.notion_name;
      option.textContent = tutor.notion_name;
      tutorSelect.appendChild(option);
    });
  }
  
  // Set values if editing
  if (schedule) {
    // Parse cron to set form values
    const cronParts = schedule.schedule_cron.split(' ');
    document.getElementById('schedule-time').value = `${cronParts[1].padStart(2, '0')}:${cronParts[0].padStart(2, '0')}`;
    document.getElementById('schedule-day').value = cronParts[4];
    document.getElementById('schedule-target-status').value = schedule.target_status;
    document.getElementById('schedule-target-tutor').value = schedule.target_tutor || '';
    document.getElementById('schedule-channel-type').value = schedule.channel_type;
    
    // Set image if exists
    if (schedule.image_url) {
      const imageId = schedule.image_url;
      document.getElementById('schedule-image-id').value = imageId;
      
      // Show image preview from server
      const previewImg = document.getElementById('schedule-image-preview-img');
      previewImg.src = `${API_BASE}/api/broadcast/images/${imageId}`;
      document.getElementById('schedule-image-preview').classList.remove('hidden');
      
      const statusElement = document.getElementById('schedule-image-upload-status');
      statusElement.className = 'mt-2 text-green-600';
      statusElement.innerHTML = '<i class="fas fa-check-circle mr-2"></i>画像を読み込みました';
      statusElement.classList.remove('hidden');
    }
    
    // Determine frequency
    if (cronParts[2] === '1-7') {
      document.getElementById('schedule-frequency').value = 'monthly';
    } else if (schedule.schedule_cron.includes('biweekly')) {
      document.getElementById('schedule-frequency').value = 'biweekly';
    } else {
      document.getElementById('schedule-frequency').value = 'weekly';
    }
  }
}

/**
 * Save schedule
 */
async function saveSchedule(scheduleId = null) {
  const name = document.getElementById('schedule-name').value.trim();
  const frequency = document.getElementById('schedule-frequency').value;
  const dayOfWeek = document.getElementById('schedule-day').value;
  const time = document.getElementById('schedule-time').value;
  const targetStatus = document.getElementById('schedule-target-status').value;
  const targetTutor = document.getElementById('schedule-target-tutor').value;
  const channelType = document.getElementById('schedule-channel-type').value;
  const content = document.getElementById('schedule-content').value.trim();
  const enabled = document.getElementById('schedule-enabled').checked;
  const imageId = document.getElementById('schedule-image-id').value.trim();
  
  if (!name || !content) {
    showNotification('スケジュール名とメッセージ内容は必須です', 'error');
    return;
  }
  
  // Validate time format (30-minute intervals)
  const [hour, minute] = time.split(':');
  if (minute !== '00' && minute !== '30') {
    showNotification('時刻は30分単位で設定してください（00分または30分）', 'error');
    return;
  }
  
  // Generate cron expression
  let cronExpression;
  
  switch (frequency) {
    case 'weekly':
      cronExpression = `${minute} ${hour} * * ${dayOfWeek}`;
      break;
    case 'biweekly':
      // Add 'biweekly' marker as a comment in the cron expression
      cronExpression = `${minute} ${hour} * * ${dayOfWeek} biweekly`;
      break;
    case 'monthly':
      cronExpression = `${minute} ${hour} 1-7 * ${dayOfWeek}`;
      break;
    default:
      cronExpression = `${minute} ${hour} * * ${dayOfWeek}`;
  }
  
  try {
    const response = await axios.post(`${API_BASE}/api/broadcast/schedules`, {
      id: scheduleId,
      name,
      content,
      imageId: imageId || null,
      channelType,
      targetStatus,
      targetTutor: targetTutor || null,
      scheduleCron: cronExpression,
      scheduleEnabled: enabled
    }, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      showNotification(`✅ スケジュールを${scheduleId ? '更新' : '作成'}しました`, 'success');
      closeModal();
      await loadSchedules();
    }
  } catch (error) {
    console.error('Error saving schedule:', error);
    showNotification('スケジュールの保存に失敗しました: ' + (error.response?.data?.error || error.message), 'error');
  }
}

/**
 * Toggle schedule enabled/disabled
 */
async function toggleSchedule(scheduleId) {
  try {
    const response = await axios.post(`${API_BASE}/api/broadcast/schedules/${scheduleId}/toggle`, {}, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      const status = response.data.enabled ? '有効' : '無効';
      showNotification(`✅ スケジュールを${status}にしました`, 'success');
      await loadSchedules();
    }
  } catch (error) {
    console.error('Error toggling schedule:', error);
    showNotification('スケジュールの切り替えに失敗しました', 'error');
  }
}

/**
 * Edit schedule
 */
function editSchedule(scheduleId) {
  showScheduleModal(scheduleId);
}

/**
 * Delete schedule
 */
async function deleteSchedule(scheduleId) {
  if (!confirm('このスケジュールを削除しますか？\nこの操作は取り消せません。')) {
    return;
  }
  
  try {
    const response = await axios.delete(`${API_BASE}/api/broadcast/schedules/${scheduleId}`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      showNotification('✅ スケジュールを削除しました', 'success');
      await loadSchedules();
    }
  } catch (error) {
    console.error('Error deleting schedule:', error);
    showNotification('スケジュールの削除に失敗しました', 'error');
  }
}

// Store schedules globally
let broadcastSchedules = [];

/**
 * Handle image upload for schedule
 */
async function handleScheduleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // Validate file size (max 8MB)
  if (file.size > 8 * 1024 * 1024) {
    showNotification('画像ファイルが大きすぎます（最大8MB）', 'error');
    return;
  }
  
  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    showNotification('対応していないファイル形式です', 'error');
    return;
  }
  
  // Show upload status
  const statusElement = document.getElementById('schedule-image-upload-status');
  statusElement.className = 'mt-2 text-purple-600';
  statusElement.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>アップロード中...';
  statusElement.classList.remove('hidden');
  
  try {
    // Create FormData
    const formData = new FormData();
    formData.append('image', file);
    
    // Upload to server
    const response = await axios.post(`${API_BASE}/api/broadcast/upload-image`, formData, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'multipart/form-data'
      }
    });
    
    if (response.data.success) {
      const imageId = response.data.imageId;
      const filename = response.data.filename;
      
      // Store imageId in hidden field
      document.getElementById('schedule-image-id').value = imageId;
      
      // Show preview using a placeholder or local object URL
      const previewImg = document.getElementById('schedule-image-preview-img');
      
      // Create object URL for preview
      const objectUrl = URL.createObjectURL(file);
      previewImg.src = objectUrl;
      document.getElementById('schedule-image-preview').classList.remove('hidden');
      
      // Update status
      statusElement.className = 'mt-2 text-green-600';
      statusElement.innerHTML = `<i class="fas fa-check-circle mr-2"></i>アップロード完了: ${filename}`;
      
      showNotification('✅ 画像をアップロードしました', 'success');
    } else {
      throw new Error(response.data.error || 'Upload failed');
    }
  } catch (error) {
    console.error('Error uploading image:', error);
    console.error('Error details:', error.response?.data);
    
    const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
    
    statusElement.className = 'mt-2 text-red-600';
    statusElement.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i>アップロード失敗: ${errorMessage}`;
    showNotification(`画像のアップロードに失敗しました: ${errorMessage}`, 'error');
  }
}

/**
 * Remove image preview for schedule
 */
function removeScheduleImagePreview() {
  document.getElementById('schedule-image-id').value = '';
  document.getElementById('schedule-image-file').value = '';
  document.getElementById('schedule-image-preview').classList.add('hidden');
  document.getElementById('schedule-image-upload-status').classList.add('hidden');
  showNotification('画像を削除しました', 'info');
}

// ========== Survey & Roulette Functions ==========

// Cache for survey stats
let surveyStatsCache = {};
let surveyStatsCacheTime = null;
const SURVEY_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
let surveyFilter = ''; // '', 'unreplied'

/**
 * Load survey statistics for all students (bulk fetch with cache)
 */
async function loadSurveyStats() {
  try {
    // Check cache
    if (surveyStatsCacheTime && (Date.now() - surveyStatsCacheTime < SURVEY_CACHE_DURATION)) {
      console.log('Using cached survey stats');
      updateAllSurveyDisplay();
      return;
    }
    
    console.log('Fetching survey stats from API...');
    const response = await axios.get(`${API_BASE}/api/survey/stats-all`);
    
    if (response.data.success) {
      surveyStatsCache = response.data.data;
      surveyStatsCacheTime = Date.now();
      console.log(`Survey stats loaded for ${Object.keys(surveyStatsCache).length} students`);
      updateAllSurveyDisplay();
    }
  } catch (error) {
    console.error('Error loading survey stats:', error);
  }
}

/**
 * Update all survey displays from cache
 */
function updateAllSurveyDisplay() {
  Object.keys(surveyStatsCache).forEach(studentId => {
    const stats = surveyStatsCache[studentId];
    updateSurveyStatsDisplay(studentId, stats);
    updateRouletteMarker(studentId, stats);
  });
}

/**
 * Test roulette draw (no Discord notification) - with animation
 */
async function testDrawRoulette(studentId) {
  try {
    console.log(`[Test Draw] Function called with studentId: ${studentId}`);
    
    if (!confirm('テスト抽選を実行します（Discord通知なし）。よろしいですか？')) {
      console.log('[Test Draw] User cancelled');
      return;
    }
    
    // Show roulette animation modal with spin button
    showRouletteModal(studentId);
    
    console.log(`[Test Draw] Modal shown for student: ${studentId}`);
    
    // テスト抽選では UI を更新しない（「抽選可能」状態を維持）
    // 本番抽選の結果のみが UI に反映される
    console.log('[Test Draw] Test draw ready - user can spin the roulette');
  } catch (error) {
    console.error('[Test Draw] Error:', error);
    console.error('[Test Draw] Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    showAlert('error', 'テスト抽選エラー: ' + (error.response?.data?.error || error.message));
  }
}

/**
 * Show prize box modal (luxury design)
 */
function showRouletteModal(studentId) {
  const student = surveyStatsCache[studentId];
  const studentName = student?.name || studentId;
  const probability = student?.resultScore === 'S' ? 100 : 50;
  
  const modalHtml = `
    <div id="rouletteModal" class="fixed inset-0 bg-gradient-to-br from-purple-900 via-pink-900 to-orange-900 bg-opacity-95 flex items-center justify-center z-50 animate-fade-in">
      <div class="bg-gradient-to-br from-white via-yellow-50 to-orange-50 rounded-3xl shadow-2xl p-12 max-w-xl w-full mx-4 relative overflow-hidden border-4 border-yellow-400">
        <!-- Decorative sparkles -->
        <div class="absolute top-4 left-4 text-yellow-400 text-2xl animate-pulse">✨</div>
        <div class="absolute top-4 right-4 text-yellow-400 text-2xl animate-pulse" style="animation-delay: 0.3s">✨</div>
        <div class="absolute bottom-4 left-4 text-yellow-400 text-2xl animate-pulse" style="animation-delay: 0.6s">✨</div>
        <div class="absolute bottom-4 right-4 text-yellow-400 text-2xl animate-pulse" style="animation-delay: 0.9s">✨</div>
        
        <div class="text-center relative z-10">
          <h2 class="text-4xl font-bold mb-3 text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600">${studentName}</h2>
          <p class="text-2xl mb-8 text-gray-700 font-semibold">🎁 アンケート特典 🎁</p>
          
          <!-- Gift box illustration -->
          <div id="giftBox" class="relative w-64 h-64 mx-auto mb-8">
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="text-9xl transform hover:scale-110 transition-transform duration-300 cursor-pointer animate-bounce">
                🎁
              </div>
            </div>
          </div>
          
          <div id="prizeStatus" class="text-xl mb-6 text-gray-700 font-semibold">
            <i class="fas fa-hand-pointer animate-pulse mr-2"></i>
            開封して特典を確認しましょう！
          </div>
          
          <button 
            id="openButton" 
            onclick="openPrizeBox()" 
            class="px-12 py-4 bg-gradient-to-r from-yellow-400 via-orange-400 to-pink-500 text-white rounded-2xl font-bold text-xl hover:from-yellow-500 hover:via-orange-500 hover:to-pink-600 transition-all transform hover:scale-110 shadow-2xl animate-pulse"
          >
            <i class="fas fa-gift mr-3"></i>開封する
          </button>
          
          <!-- Result container (hidden initially) -->
          <div id="prizeResult" class="hidden mt-8">
            <div id="resultContent" class="text-6xl font-bold mb-6"></div>
            <div id="resultMessage" class="text-2xl mb-8 font-semibold"></div>
            <button 
              onclick="closeRouletteModal()" 
              class="px-8 py-3 bg-gradient-to-r from-gray-600 to-gray-700 text-white rounded-xl font-semibold hover:from-gray-700 hover:to-gray-800 transition-all transform hover:scale-105 shadow-lg"
            >
              <i class="fas fa-times mr-2"></i>閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <style>
      @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .animate-fade-in {
        animation: fade-in 0.5s ease-out;
      }
    </style>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Open prize box and reveal result
 */
async function openPrizeBox() {
  const openButton = document.getElementById('openButton');
  const prizeStatus = document.getElementById('prizeStatus');
  const giftBox = document.getElementById('giftBox');
  
  if (openButton) openButton.disabled = true;
  if (prizeStatus) prizeStatus.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>開封中...';
  
  // Get student ID from modal
  const studentName = document.querySelector('#rouletteModal h2').textContent;
  const studentId = Object.keys(surveyStatsCache).find(id => surveyStatsCache[id]?.name === studentName);
  
  if (!studentId) {
    console.error('[Prize] Student ID not found');
    return;
  }
  
  try {
    // Call test draw API
    const response = await axios.post(`${API_BASE}/api/roulette/test-draw`, {
      studentId: studentId
    });
    
    if (response.data.success) {
      const result = response.data.data;
      
      // Animate gift box opening
      if (giftBox) {
        giftBox.style.transform = 'scale(1.5)';
        giftBox.style.opacity = '0';
        giftBox.style.transition = 'all 0.8s ease-out';
      }
      
      // Wait for animation
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Hide button and status
      if (openButton) openButton.style.display = 'none';
      if (prizeStatus) prizeStatus.classList.add('hidden');
      if (giftBox) giftBox.classList.add('hidden');
      
      // Show result
      showPrizeResult(result);
      
    } else {
      console.error('[Prize] API returned error:', response.data.error);
      if (prizeStatus) prizeStatus.innerHTML = '<i class="fas fa-exclamation-triangle text-red-500"></i> エラーが発生しました';
      if (openButton) openButton.disabled = false;
    }
  } catch (error) {
    console.error('[Prize] Error:', error);
    if (prizeStatus) prizeStatus.innerHTML = '<i class="fas fa-exclamation-triangle text-red-500"></i> エラーが発生しました';
    if (openButton) openButton.disabled = false;
  }
}

/**
 * Show prize result with celebration or sympathy
 */
async function showPrizeResult(result) {
  const resultContainer = document.getElementById('prizeResult');
  const resultContent = document.getElementById('resultContent');
  const resultMessage = document.getElementById('resultMessage');
  
  if (resultContainer && resultContent && resultMessage) {
    const isWin = result.result === '当たり';
    
    if (isWin) {
      // Celebration theme for winner
      resultContainer.parentElement.parentElement.className = 'bg-gradient-to-br from-yellow-100 via-orange-100 to-pink-100 rounded-3xl shadow-2xl p-12 max-w-xl w-full mx-4 relative overflow-hidden border-4 border-yellow-400';
      
      resultContent.innerHTML = `
        <div class="animate-bounce">
          <div class="text-8xl mb-4">🏆</div>
          <div class="text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-orange-500 to-pink-500">当たり！</div>
        </div>
      `;
      
      resultMessage.innerHTML = `
        <div class="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600">
          🎉 おめでとうございます！ 🎉<br>
          <span class="text-xl">特典をお送りします！</span>
        </div>
      `;
      
      // Add confetti effect
      createConfetti();
      
    } else {
      // Sympathy theme for loser
      resultContainer.parentElement.parentElement.className = 'bg-gradient-to-br from-gray-100 via-blue-50 to-purple-50 rounded-3xl shadow-2xl p-12 max-w-xl w-full mx-4 relative overflow-hidden border-4 border-gray-300';
      
      resultContent.innerHTML = `
        <div class="text-8xl mb-4 opacity-60">😢</div>
        <div class="text-gray-600">はずれ</div>
      `;
      
      resultMessage.innerHTML = `
        <div class="text-gray-600">
          残念でした...<br>
          <span class="text-xl">また次回チャレンジしてください！</span>
        </div>
      `;
    }
    
    resultContainer.classList.remove('hidden');
    resultContainer.style.animation = 'bounce 0.6s ease-out';
  }
}

/**
 * Create confetti animation for winners
 */
function createConfetti() {
  const colors = ['#FFD700', '#FFA500', '#FF69B4', '#FF1493', '#8B008B'];
  const confettiCount = 50;
  
  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement('div');
    confetti.style.position = 'fixed';
    confetti.style.width = '10px';
    confetti.style.height = '10px';
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.left = Math.random() * window.innerWidth + 'px';
    confetti.style.top = '-10px';
    confetti.style.opacity = '1';
    confetti.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
    confetti.style.transition = 'all 3s ease-out';
    confetti.style.zIndex = '9999';
    confetti.style.pointerEvents = 'none';
    
    document.body.appendChild(confetti);
    
    // Animate falling
    setTimeout(() => {
      confetti.style.top = window.innerHeight + 'px';
      confetti.style.left = (parseFloat(confetti.style.left) + (Math.random() - 0.5) * 200) + 'px';
      confetti.style.opacity = '0';
      confetti.style.transform = 'rotate(' + (Math.random() * 720) + 'deg)';
    }, 100);
    
    // Remove after animation
    setTimeout(() => {
      confetti.remove();
    }, 3100);
  }
}

/**
 * Show roulette result with animation
 */
/**
 * Close roulette modal
 */
function closeRouletteModal() {
  const modal = document.getElementById('rouletteModal');
  if (modal) {
    modal.remove();
  }
}

/**
 * Reset all test roulette results
 * テスト抽選結果を全て削除し、生徒を「抽選可能」状態に戻す
 */
async function resetTestRouletteResults() {
  try {
    if (!confirm('全てのテスト抽選結果を削除します。\n生徒のUI表示が「抽選可能」に戻ります。\nよろしいですか？')) {
      return;
    }
    
    console.log('[Reset Test Roulette] Sending request to delete test results...');
    
    const response = await axios.post(`${API_BASE}/api/roulette/reset-test-results`);
    
    if (response.data.success) {
      const { deletedCount, studentCount, message } = response.data.data;
      console.log(`[Reset Test Roulette] Success: ${message}`);
      console.log(`[Reset Test Roulette] Deleted ${deletedCount} records for ${studentCount} students`);
      
      showAlert('success', message);
      
      // Refresh page data to reflect changes
      await refreshData();
    } else {
      console.error('[Reset Test Roulette] API returned error:', response.data.error);
      showAlert('error', 'テスト抽選リセットに失敗しました: ' + response.data.error);
    }
  } catch (error) {
    console.error('[Reset Test Roulette] Error:', error);
    showAlert('error', 'テスト抽選リセットエラー: ' + (error.response?.data?.error || error.message));
  }
}

/**
 * Load lesson completion status for all students in batch
 */
async function loadLessonCompletionBatch() {
  try {
    const filteredStudents = getFilteredStudents();
    
    // Build items array: for each student, get their lesson dates
    const items = [];
    filteredStudents.forEach(student => {
      const dates = lessonDates[student.student_id] || [];
      dates.forEach(dateObj => {
        // Convert Date object to YYYY-MM-DD format
        const date = dateObj.date;
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const lessonDate = `${year}-${month}-${day}`;
        
        items.push({
          studentId: student.student_id,
          lessonDate: lessonDate
        });
      });
    });
    
    if (items.length === 0) {
      console.log('[Lesson Completion] No lesson dates to check');
      return;
    }
    
    console.log(`[Lesson Completion] Checking ${items.length} lesson dates for ${filteredStudents.length} students`);
    console.log('[Lesson Completion] Sample items:', items.slice(0, 3));
    
    // Call batch API
    const response = await axios.post(`${API_BASE}/api/lesson-completion/batch`, {
      items
    });
    
    if (response.data.success) {
      const results = response.data.data;
      console.log(`[Lesson Completion] Loaded ${results.length} lesson completion records`);
      console.log('[Lesson Completion] Sample results:', results.slice(0, 3));
      
      // Group results by studentId
      const completionByStudent = {};
      results.forEach(result => {
        if (!completionByStudent[result.studentId]) {
          completionByStudent[result.studentId] = [];
        }
        completionByStudent[result.studentId].push(result);
      });
      
      // Update UI for each student
      filteredStudents.forEach(student => {
        const studentCompletions = completionByStudent[student.student_id] || [];
        updateLessonCompletionDisplay(student.student_id, studentCompletions);
      });
    }
  } catch (error) {
    console.error('[Lesson Completion] Error loading lesson completion:', error);
  }
}

/**
 * Update lesson completion display for a student
 */
function updateLessonCompletionDisplay(studentId, completions) {
  const cell = document.querySelector(`.lesson-completion-loading[data-student-id="${studentId}"]`);
  
  if (!cell) return;
  
  if (completions.length === 0) {
    cell.innerHTML = '<span class="text-gray-400">-</span>';
    return;
  }
  
  // Count completed lessons
  const completedCount = completions.filter(c => c.completed).length;
  const totalCount = completions.length;
  
  let html = '<div class="space-y-1">';
  
  // Show summary
  if (completedCount === totalCount) {
    html += `<div class="flex items-center justify-center gap-1 text-green-600 font-semibold">
      <i class="fas fa-check-circle"></i>
      <span>${completedCount}/${totalCount}</span>
    </div>`;
  } else if (completedCount === 0) {
    html += `<div class="flex items-center justify-center gap-1 text-red-600 font-semibold">
      <i class="fas fa-times-circle"></i>
      <span>${completedCount}/${totalCount}</span>
    </div>`;
  } else {
    html += `<div class="flex items-center justify-center gap-1 text-orange-600 font-semibold">
      <i class="fas fa-exclamation-circle"></i>
      <span>${completedCount}/${totalCount}</span>
    </div>`;
  }
  
  // Show details for each lesson
  completions.forEach(c => {
    const statusIcon = c.completed 
      ? '<i class="fas fa-check text-green-600"></i>' 
      : '<i class="fas fa-times text-red-600"></i>';
    const statusText = c.lessonResult || '未記入';
    // Ensure lessonDate is a string and extract M/D format
    const lessonDateStr = String(c.lessonDate);
    let dateStr;
    if (lessonDateStr.includes('-')) {
      // Format: YYYY-MM-DD -> M/D
      const parts = lessonDateStr.split('-');
      dateStr = `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    } else {
      // Fallback
      dateStr = lessonDateStr.substring(5);
    }
    
    html += `<div class="text-xs text-gray-600 flex items-center justify-between gap-2">
      <span>${dateStr}</span>
      ${statusIcon}
    </div>`;
  });
  
  html += '</div>';
  
  cell.innerHTML = html;
}

/**
 * Load survey stats for a single student
 */
async function loadStudentSurveyStats(studentId) {
  try {
    const response = await axios.get(`${API_BASE}/api/survey/stats/${studentId}`);
    
    if (response.data.success) {
      const stats = response.data.data;
      updateSurveyStatsDisplay(studentId, stats);
      updateRouletteMarker(studentId, stats);
      return stats;
    }
  } catch (error) {
    console.error(`Error loading survey stats for ${studentId}:`, error);
    updateSurveyStatsDisplay(studentId, null);
    updateRouletteMarker(studentId, null);
  }
  return null;
}

/**
 * Update survey stats display in the table
 */
function updateSurveyStatsDisplay(studentId, stats) {
  const surveyCell = document.querySelector(`.survey-stats-loading[data-student-id="${studentId}"]`);
  const rouletteCell = document.querySelector(`.roulette-result-loading[data-student-id="${studentId}"]`);
  
  if (!surveyCell || !rouletteCell) {
    console.log(`[Survey Display] Cells not found for student: ${studentId}, surveyCell: ${!!surveyCell}, rouletteCell: ${!!rouletteCell}`);
    return;
  }
  
  if (!stats) {
    surveyCell.innerHTML = '<span class="text-gray-400">-</span>';
    rouletteCell.innerHTML = '<span class="text-gray-400">-</span>';
    return;
  }
  
  // Survey stats display (simplified)
  const responseCount = stats.responseCount || 0;
  const responseRate = stats.responseRate || 0;
  const respondedThisMonth = stats.respondedThisMonth || false;
  
  let surveyHtml = `
    <div class="text-xs">
      ${!respondedThisMonth ? '<span class="px-1 py-0.5 text-xs font-bold bg-red-500 text-white rounded">!</span>' : '<span class="text-green-500">✓</span>'}
      <div class="font-semibold text-blue-600">${responseRate}%</div>
    </div>
  `;
  
  // Add eligible badge if student is eligible
  if (stats.isEligible && stats.isEligible.isEligible) {
    surveyHtml += `
      <div class="mt-0.5 px-1 py-0.5 text-xs font-bold bg-yellow-400 text-white rounded">
        <i class="fas fa-gift"></i>
      </div>
    `;
  }
  
  surveyCell.innerHTML = surveyHtml;
  
  // Roulette result display
  const rouletteResult = stats.latestRouletteResult;
  const isEligible = stats.isEligible && stats.isEligible.isEligible;
  
  // Debug log for first 3 students
  if (window.rouletteDebugCount === undefined) window.rouletteDebugCount = 0;
  if (window.rouletteDebugCount < 3) {
    console.log(`[Roulette Debug] Student: ${stats.name} (${studentId})`);
    console.log(`  - Has roulette result:`, !!rouletteResult);
    console.log(`  - Is eligible:`, isEligible);
    console.log(`  - Eligibility reason:`, stats.isEligible?.reason);
    console.log(`  - Extension result:`, stats.extensionResult);
    console.log(`  - Status:`, stats.status);
    console.log(`  - Response rate:`, stats.responseRate);
    window.rouletteDebugCount++;
  }
  
  if (rouletteResult) {
    const isWin = rouletteResult.result === '当たり';
    
    rouletteCell.innerHTML = `
      <div class="text-xs font-semibold ${isWin ? 'text-red-500' : 'text-gray-500'}">
        <i class="fas ${isWin ? 'fa-trophy' : 'fa-times-circle'}"></i>
      </div>
    `;
    console.log(`[Roulette Display] Student ${studentId}: Result ${isWin ? 'WIN' : 'LOSE'} displayed`);
  } else if (stats.isEligible && stats.isEligible.isEligible) {
    // Eligible but not yet drawn
    rouletteCell.innerHTML = `
      <button 
        onclick="testDrawRoulette('${stats.studentId}')"
        class="px-1 py-0.5 bg-purple-500 hover:bg-purple-600 text-white text-xs rounded"
        title="テスト抽選"
      >
        <i class="fas fa-dice"></i>
      </button>
    `;
    console.log(`[Roulette Display] Student ${studentId}: Test draw button displayed (eligible)`);
  } else {
    rouletteCell.innerHTML = '<span class="text-gray-400 text-xs">-</span>';
    console.log(`[Roulette Display] Student ${studentId}: Not eligible or no result`);
  }
}

/**
 * Update roulette marker on reservation/today pages
 */
function updateRouletteMarker(studentId, stats) {
  const markerCell = document.querySelector(`.roulette-marker-loading[data-student-id="${studentId}"]`);
  
  if (!markerCell) return;
  
  if (!stats || !stats.isEligible || !stats.isEligible.isEligible) {
    markerCell.innerHTML = '';
    return;
  }
  
  // Determine marker color based on result_overall score
  const isS = stats.resultScore === 'S';
  const probability = isS ? 100 : 50;
  const colorClass = isS ? 'text-yellow-500' : 'text-green-500';
  const bgClass = isS ? 'bg-yellow-100 border-yellow-500' : 'bg-green-100 border-green-500';
  
  markerCell.innerHTML = `
    <span 
      class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold border-2 ${bgClass} ${colorClass} animate-pulse"
      title="アンケート特典対象 (抽選確率: ${probability}%)"
    >
      <i class="fas fa-dice text-base mr-1"></i>
      ${probability}%
    </span>
  `;
}

// ========== Survey Filter ==========

/**
 * Toggle survey filter for unreplied students this month
 */
function toggleSurveyFilter() {
  surveyFilter = surveyFilter === 'unreplied' ? '' : 'unreplied';
  
  console.log('[Survey Filter] Toggled to:', surveyFilter);
  console.log('[Survey Filter] Cache has', Object.keys(surveyStatsCache).length, 'students');
  
  // Re-render student page
  if (typeof renderStudentsPage === 'function') {
    renderStudentsPage();
  }
  
  showNotification(
    surveyFilter === 'unreplied' ? '今月未回答の生徒のみ表示' : 'フィルター解除',
    'info'
  );
}

// ========== Survey Notification Toggle ==========

let surveyNotificationEnabled = false;

/**
 * Load survey notification setting
 */
async function loadSurveyNotificationSetting() {
  try {
    const response = await axios.get(`${API_BASE}/api/settings/survey_notification_enabled`);
    
    if (response.data.success) {
      surveyNotificationEnabled = response.data.data.setting_value === 'true';
      updateSurveyToggleUI();
    }
  } catch (error) {
    console.error('Error loading survey notification setting:', error);
  }
}

/**
 * Toggle survey notification ON/OFF
 */
async function toggleSurveyNotification() {
  try {
    const newValue = !surveyNotificationEnabled;
    
    const response = await axios.put(
      `${API_BASE}/api/settings/survey_notification_enabled`,
      {
        value: newValue.toString(),
        updatedBy: currentUser.tutorName || currentUser.email
      }
    );
    
    if (response.data.success) {
      surveyNotificationEnabled = newValue;
      updateSurveyToggleUI();
      
      showNotification(
        `特典通知を${newValue ? 'ON' : 'OFF'}にしました`,
        newValue ? 'success' : 'info'
      );
    }
  } catch (error) {
    console.error('Error toggling survey notification:', error);
    showNotification('特典通知の切り替えに失敗しました', 'error');
  }
}

/**
 * Update survey toggle UI
 */
function updateSurveyToggleUI() {
  const toggle = document.getElementById('survey-notification-toggle');
  const indicator = document.getElementById('survey-toggle-indicator');
  const label = document.getElementById('survey-toggle-label');
  
  if (!toggle || !indicator || !label) return;
  
  if (surveyNotificationEnabled) {
    // ON state
    toggle.classList.remove('bg-gray-400');
    toggle.classList.add('bg-green-500');
    indicator.classList.add('translate-x-5');
    label.textContent = 'ON';
  } else {
    // OFF state
    toggle.classList.remove('bg-green-500');
    toggle.classList.add('bg-gray-400');
    indicator.classList.remove('translate-x-5');
    label.textContent = 'OFF';
  }
}

// ========================================
// VQ診断管理
// ========================================

let vqDiagnosisEnabled = false;
let vqDiagnosisHistory = [];
let vqDiagnosisImages = [];

/**
 * VQ診断管理ページをレンダリング
 */
async function renderVQDiagnosisPage() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  
  const content = document.getElementById('content');
  
  // 権限チェック：リーダー以上のみアクセス可能
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'leader')) {
    content.innerHTML = `
      <div class="max-w-2xl mx-auto">
        <div class="bg-red-50 border-l-4 border-red-500 rounded-lg p-6">
          <div class="flex items-center mb-4">
            <i class="fas fa-exclamation-triangle text-3xl text-red-600 mr-4"></i>
            <h3 class="text-xl font-bold text-red-800">アクセス権限がありません</h3>
          </div>
          <p class="text-red-700 mb-4">
            このページはリーダー以上の権限を持つユーザーのみアクセスできます。
          </p>
          <button onclick="changePage('today')" class="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">
            <i class="fas fa-home mr-2"></i>ホームに戻る
          </button>
        </div>
      </div>
    `;
    return;
  }
  
  // ロード中表示
  content.innerHTML = `
    <div class="flex items-center justify-center py-12">
      <div class="text-center">
        <i class="fas fa-spinner fa-spin text-4xl text-purple-600 mb-4"></i>
        <p class="text-gray-600">VQ診断データを読み込み中...</p>
      </div>
    </div>
  `;
  
  // データ取得
  await loadVQDiagnosisData();
  
  // ページレンダリング
  content.innerHTML = `
    <div class="max-w-7xl mx-auto">
      <!-- Header -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-gray-800 mb-2">
              <i class="fas fa-clipboard-check mr-3 text-purple-600"></i>
              VQ診断管理
            </h2>
            <p class="text-sm text-gray-600">
              VQ診断結果を自動的にDiscordに送信します
            </p>
          </div>
          
          <!-- System Toggle -->
          <div class="flex items-center gap-4">
            <span class="text-sm font-semibold text-gray-700">システム</span>
            <button 
              id="vq-diagnosis-toggle" 
              onclick="toggleVQDiagnosisSystem()"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${vqDiagnosisEnabled ? 'bg-green-500' : 'bg-gray-400'}"
            >
              <span 
                id="vq-toggle-indicator"
                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${vqDiagnosisEnabled ? 'translate-x-6' : 'translate-x-1'}"
              ></span>
            </button>
            <span id="vq-toggle-label" class="text-sm font-bold ${vqDiagnosisEnabled ? 'text-green-600' : 'text-gray-500'}">
              ${vqDiagnosisEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>
        

      </div>
      
      <!-- Stats -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-600 mb-1">送信済み（全期間）</p>
              <p class="text-2xl font-bold text-gray-800">${vqDiagnosisHistory.filter(h => h.status === 'sent').length}件</p>
            </div>
            <i class="fas fa-check-circle text-3xl text-green-500"></i>
          </div>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-600 mb-1">エラー</p>
              <p class="text-2xl font-bold text-gray-800">${vqDiagnosisHistory.filter(h => h.status === 'error').length}件</p>
            </div>
            <i class="fas fa-exclamation-circle text-3xl text-red-500"></i>
          </div>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-600 mb-1">今月の送信</p>
              <p class="text-2xl font-bold text-gray-800">${getThisMonthVQCount()}件</p>
            </div>
            <i class="fas fa-calendar-alt text-3xl text-purple-500"></i>
          </div>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-600 mb-1">システム状態</p>
              <p class="text-lg font-bold ${vqDiagnosisEnabled ? 'text-green-600' : 'text-gray-500'}">
                ${vqDiagnosisEnabled ? '有効' : '無効'}
              </p>
            </div>
            <i class="fas fa-power-off text-3xl ${vqDiagnosisEnabled ? 'text-green-500' : 'text-gray-400'}"></i>
          </div>
        </div>
      </div>
      
      <!-- Image Settings Section -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <div class="mb-4">
          <h3 class="text-lg font-bold text-gray-800 mb-2">
            <i class="fas fa-image mr-2"></i>
            診断タイプ別画像設定
          </h3>
          <p class="text-sm text-gray-600">
            各診断タイプに対して、Discordで送信する画像URLを設定できます
          </p>
        </div>
        
        <!-- Add New Image Form -->
        <div class="bg-purple-50 rounded-lg p-4 mb-4">
          <h4 class="text-md font-semibold text-gray-800 mb-3">新規追加</h4>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input 
              type="text" 
              id="new-diagnosis-type"
              placeholder="診断タイプ（例: Vタイプ・型A）"
              class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
            <input 
              type="text" 
              id="new-image-url"
              placeholder="画像URL（https://...）"
              class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
            <button 
              onclick="saveVQDiagnosisImage()"
              class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold"
            >
              <i class="fas fa-plus mr-2"></i>追加
            </button>
          </div>
        </div>
        
        <!-- Image List -->
        <div class="space-y-2">
          ${vqDiagnosisImages.length === 0 ? `
            <div class="text-center py-6 text-gray-500">
              <i class="fas fa-info-circle mr-2"></i>
              画像設定はまだありません
            </div>
          ` : vqDiagnosisImages.map(img => `
            <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
              <div class="flex-1">
                <div class="font-semibold text-gray-800">${img.diagnosis_type}</div>
                <div class="text-sm text-gray-600 truncate">${img.image_url}</div>
              </div>
              <div class="flex items-center gap-2">
                <a 
                  href="${img.image_url}" 
                  target="_blank" 
                  class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition text-sm"
                >
                  <i class="fas fa-external-link-alt"></i>
                </a>
                <button 
                  onclick="deleteVQDiagnosisImage(${img.id})"
                  class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition text-sm"
                >
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <!-- Manual Check Button -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-bold text-gray-800 mb-2">
              <i class="fas fa-sync-alt mr-2"></i>
              手動チェック
            </h3>
            <p class="text-sm text-gray-600">
              スプレッドシートから新規診断結果を即座にチェックして送信します（5分に1回自動実行）
            </p>
          </div>
          <button 
            onclick="manualCheckVQDiagnosis()"
            class="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold"
          >
            <i class="fas fa-play mr-2"></i>今すぐチェック
          </button>
        </div>
      </div>
      
      <!-- Resend and Management Section -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <!-- Single Row Resend -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h3 class="text-lg font-bold text-gray-800 mb-2">
            <i class="fas fa-arrow-right mr-2 text-blue-600"></i>
            特定行を再送信
          </h3>
          <p class="text-sm text-gray-600 mb-4">
            スプレッドシートの指定行をR列の状態に関係なく再送信します
          </p>
          
          <div class="mb-4">
            <label class="block text-sm font-semibold text-gray-700 mb-2">
              行番号（2以上）
            </label>
            <input 
              type="number" 
              id="vq-single-row" 
              min="2"
              placeholder="例: 595"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <button 
            onclick="resendVQSingleRow()"
            class="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
          >
            <i class="fas fa-paper-plane mr-2"></i>この行を再送信
          </button>
        </div>
        
        <!-- Range Resend -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h3 class="text-lg font-bold text-gray-800 mb-2">
            <i class="fas fa-arrow-down mr-2 text-indigo-600"></i>
            指定行から範囲再送信
          </h3>
          <p class="text-sm text-gray-600 mb-4">
            指定行から未送信（R列が「完了」でない）のレコードを順次送信
          </p>
          
          <div class="mb-4">
            <label class="block text-sm font-semibold text-gray-700 mb-2">
              開始行番号（2以上）
            </label>
            <input 
              type="number" 
              id="vq-start-row" 
              min="2"
              placeholder="例: 595"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          
          <button 
            onclick="resendVQFromRow()"
            class="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-semibold"
          >
            <i class="fas fa-paper-plane mr-2"></i>範囲再送信を実行
          </button>
        </div>
      </div>
      
      <!-- Test Send Button -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-6 border-2 border-orange-200">
        <div class="mb-4">
          <h3 class="text-lg font-bold text-gray-800 mb-2">
            <i class="fas fa-flask mr-2 text-orange-600"></i>
            テスト送信
          </h3>
          <p class="text-sm text-gray-600 mb-3">
            スプレッドシートからランダムにレコードを選択してDiscordに送信します（R列の状態は無視）
          </p>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">
              Discordチャンネル URL <span class="text-red-500">*</span>
            </label>
            <input 
              type="text" 
              id="test-channel-url"
              placeholder="https://discord.com/channels/1176426605309083678/1293539258069417994"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
              value="https://discord.com/channels/1176426605309083678/1293539258069417994"
            />
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">
              メンション先ユーザーID（オプション）
            </label>
            <input 
              type="text" 
              id="test-user-id"
              placeholder="766666980086120470"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
              value="766666980086120470"
            />
          </div>
        </div>
        
        <button 
          onclick="testSendVQDiagnosis()"
          class="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition font-semibold"
        >
          <i class="fas fa-paper-plane mr-2"></i>テスト送信
        </button>
      </div>
      
      <!-- History Table -->
      <div class="bg-white rounded-lg shadow-md overflow-hidden">
        <div class="p-6 border-b border-gray-200">
          <h3 class="text-lg font-bold text-gray-800">
            <i class="fas fa-history mr-2"></i>
            送信履歴
          </h3>
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">診断日</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">送信日時</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">学籍番号</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">生徒名</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">合計点</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">診断タイプ</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">概要</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">状態</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              ${renderVQDiagnosisHistoryRows()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

/**
 * VQ診断データを読み込み
 */
async function loadVQDiagnosisData() {
  try {
    // システム状態を取得
    const statusResponse = await axios.get(`${API_BASE}/api/vq-diagnosis/status`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    vqDiagnosisEnabled = statusResponse.data.enabled;
    
    // 履歴を取得
    const historyResponse = await axios.get(`${API_BASE}/api/vq-diagnosis/history`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    vqDiagnosisHistory = historyResponse.data.history || [];
    
    // 画像設定を取得
    const imagesResponse = await axios.get(`${API_BASE}/api/vq-diagnosis/images`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    vqDiagnosisImages = imagesResponse.data.images || [];
    
  } catch (error) {
    console.error('VQ診断データの読み込みエラー:', error);
    showNotification('データの読み込みに失敗しました', 'error');
  }
}

/**
 * VQ診断システムのON/OFFを切り替え
 */
async function toggleVQDiagnosisSystem() {
  try {
    const newState = !vqDiagnosisEnabled;
    
    const response = await axios.post(
      `${API_BASE}/api/vq-diagnosis/toggle`,
      { enabled: newState },
      { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    if (response.data.success) {
      vqDiagnosisEnabled = newState;
      updateVQDiagnosisToggle();
      showNotification(
        `VQ診断通知システムを${newState ? 'ON' : 'OFF'}にしました`,
        'success'
      );
      
      // ページを再読み込み
      await renderVQDiagnosisPage();
    }
    
  } catch (error) {
    console.error('システム状態の切り替えエラー:', error);
    showNotification('システム状態の切り替えに失敗しました', 'error');
  }
}

/**
 * VQ診断トグルUIを更新
 */
function updateVQDiagnosisToggle() {
  const toggle = document.getElementById('vq-diagnosis-toggle');
  const indicator = document.getElementById('vq-toggle-indicator');
  const label = document.getElementById('vq-toggle-label');
  
  if (!toggle || !indicator || !label) return;
  
  if (vqDiagnosisEnabled) {
    // ON state
    toggle.classList.remove('bg-gray-400');
    toggle.classList.add('bg-green-500');
    indicator.classList.add('translate-x-6');
    label.textContent = 'ON';
    label.classList.remove('text-gray-500');
    label.classList.add('text-green-600');
  } else {
    // OFF state
    toggle.classList.remove('bg-green-500');
    toggle.classList.add('bg-gray-400');
    indicator.classList.remove('translate-x-6');
    label.textContent = 'OFF';
    label.classList.remove('text-green-600');
    label.classList.add('text-gray-500');
  }
}

/**
 * 今月のVQ診断送信数を取得
 */
function getThisMonthVQCount() {
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  
  return vqDiagnosisHistory.filter(h => {
    const sentDate = new Date(h.sent_at);
    return sentDate.getMonth() === thisMonth && 
           sentDate.getFullYear() === thisYear &&
           h.status === 'sent';
  }).length;
}

/**
 * VQ診断履歴テーブルの行をレンダリング
 */
function renderVQDiagnosisHistoryRows() {
  if (vqDiagnosisHistory.length === 0) {
    return `
      <tr>
        <td colspan="9" class="px-6 py-8 text-center text-gray-500">
          <i class="fas fa-inbox text-4xl mb-2"></i>
          <p>送信履歴がありません</p>
        </td>
      </tr>
    `;
  }
  
  return vqDiagnosisHistory.map(record => {
    const statusColor = record.status === 'sent' ? 'green' : 'red';
    const statusIcon = record.status === 'sent' ? 'check-circle' : 'exclamation-circle';
    const statusText = record.status === 'sent' ? '送信済み' : 'エラー';
    
    const overviewShort = (record.overview || '').length > 40 
      ? record.overview.substring(0, 40) + '...' 
      : record.overview;
    
    const studentIdCode = record.student_id_code || '-';
    const diagnosisDate = record.diagnosis_date || '-';
    
    return `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 text-sm text-gray-900">
          ${escapeHtml(diagnosisDate)}
        </td>
        <td class="px-6 py-4 text-sm text-gray-900">
          ${formatDateTime(record.sent_at)}
        </td>
        <td class="px-6 py-4 text-sm text-gray-900">
          <button 
            onclick="showStudentVQHistory('${studentIdCode}')"
            class="text-blue-600 hover:underline font-mono"
            title="この生徒の全履歴を表示"
          >
            ${escapeHtml(studentIdCode)}
          </button>
        </td>
        <td class="px-6 py-4 text-sm font-medium text-gray-900">
          ${escapeHtml(record.student_name)}
        </td>
        <td class="px-6 py-4 text-sm text-gray-900">
          <span class="font-bold text-purple-600">${record.total_score}点</span>
        </td>
        <td class="px-6 py-4 text-sm text-gray-900">
          <span class="px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-semibold">
            ${escapeHtml(record.diagnosis_type)}
          </span>
        </td>
        <td class="px-6 py-4 text-sm text-gray-600">
          ${escapeHtml(overviewShort)}
        </td>
        <td class="px-6 py-4 text-sm">
          <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-${statusColor}-100 text-${statusColor}-800">
            <i class="fas fa-${statusIcon} mr-1"></i>
            ${statusText}
          </span>
          ${record.error_message ? `<p class="text-xs text-red-600 mt-1">${escapeHtml(record.error_message)}</p>` : ''}
        </td>
        <td class="px-6 py-4 text-sm">
          <div class="flex gap-2">
            <button 
              onclick="resendVQDiagnosis(${record.id})"
              class="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 transition text-xs"
              title="再送信"
            >
              <i class="fas fa-redo mr-1"></i>再送信
            </button>
            <button 
              onclick="deleteVQHistory(${record.id}, '${escapeHtml(record.student_name || studentIdCode)}')"
              class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition text-xs"
              title="履歴を削除"
            >
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * VQ診断を再送信
 */
async function resendVQDiagnosis(id) {
  if (!confirm('この診断結果を再送信しますか？')) {
    return;
  }
  
  try {
    const response = await axios.post(
      `${API_BASE}/api/vq-diagnosis/resend/${id}`,
      {},
      { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    if (response.data.success) {
      showNotification('再送信しました', 'success');
      await renderVQDiagnosisPage();
    }
    
  } catch (error) {
    console.error('再送信エラー:', error);
    showNotification(
      error.response?.data?.error || '再送信に失敗しました',
      'error'
    );
  }
}

/**
 * 日時フォーマット（YYYY-MM-DD HH:MM）
 */
function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * HTMLエスケープ
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 生徒別のVQ診断履歴を表示
 */
async function showStudentVQHistory(studentId) {
  try {
    console.log('VQ診断履歴取得開始:', studentId);
    
    const response = await axios.get(
      `${API_BASE}/api/vq-diagnosis/student/${studentId}`,
      { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    console.log('VQ診断API レスポンス:', response.data);
    
    const history = response.data.history || [];
    
    console.log('取得した履歴件数:', history.length);
    
    if (history.length === 0) {
      showNotification('この生徒の診断履歴はありません', 'info');
      return;
    }
    
    // モーダルで表示
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div class="p-6 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
          <h3 class="text-xl font-bold text-gray-800">
            <i class="fas fa-history mr-2 text-purple-600"></i>
            ${history[0].student_name} さんの診断履歴（全${history.length}件）
          </h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times text-2xl"></i>
          </button>
        </div>
        
        <div class="p-6">
          <!-- Charts Section -->
          ${history.length > 0 ? `
            <div class="grid grid-cols-1 ${history.length > 1 ? 'md:grid-cols-2' : ''} gap-6 mb-6">
              <!-- Radar Chart (Latest) -->
              <div class="bg-purple-50 rounded-lg p-4">
                <h4 class="text-md font-semibold text-gray-800 mb-3 text-center">
                  <i class="fas fa-chart-radar mr-2"></i>
                  最新の正解率（${history[0].diagnosis_date || '日付不明'}）
                </h4>
                <canvas id="vq-radar-chart" style="max-height: 300px;"></canvas>
              </div>
              
              <!-- Line Chart (Trend) - Only if multiple records -->
              ${history.length > 1 ? `
                <div class="bg-blue-50 rounded-lg p-4">
                  <h4 class="text-md font-semibold text-gray-800 mb-3 text-center">
                    <i class="fas fa-chart-line mr-2"></i>
                    スコア推移（全${history.length}回）
                  </h4>
                  <canvas id="vq-trend-chart" style="max-height: 300px;"></canvas>
                </div>
              ` : ''}
            </div>
          ` : ''}
          
          <div class="space-y-4">
            ${history.map((record, index) => `
              <div class="border border-gray-200 rounded-lg p-4 ${record.status === 'sent' ? 'bg-green-50' : 'bg-red-50'}">
                <div class="flex items-start justify-between mb-2">
                  <div>
                    <span class="text-sm font-semibold text-gray-700">診断 ${history.length - index}回目</span>
                    ${record.diagnosis_date ? `<span class="ml-3 text-sm text-gray-600">診断日: ${record.diagnosis_date}</span>` : ''}
                  </div>
                  <span class="px-2 py-1 rounded-full text-xs font-semibold ${record.status === 'sent' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${record.status === 'sent' ? '送信済み' : 'エラー'}
                  </span>
                </div>
                
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                  <div>
                    <p class="text-xs text-gray-600">合計点</p>
                    <p class="text-lg font-bold text-purple-600">${record.total_score}点</p>
                  </div>
                  <div>
                    <p class="text-xs text-gray-600">SNS</p>
                    <p class="text-sm font-semibold text-blue-600">${record.sns_score || 0}点</p>
                  </div>
                  <div>
                    <p class="text-xs text-gray-600">配信</p>
                    <p class="text-sm font-semibold text-green-600">${record.streaming_score || 0}点</p>
                  </div>
                  <div>
                    <p class="text-xs text-gray-600">収益</p>
                    <p class="text-sm font-semibold text-amber-600">${record.revenue_score || 0}点</p>
                  </div>
                </div>
                
                <div class="mb-3">
                  <p class="text-xs text-gray-600 mb-1">診断タイプ</p>
                  <span class="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-semibold">
                    ${escapeHtml(record.diagnosis_type)}
                  </span>
                </div>
                
                <!-- 正解率 -->
                <div class="mb-3 bg-white rounded-lg p-3 border border-gray-200">
                  <p class="text-xs text-gray-600 mb-2 font-semibold">正解率</p>
                  <div class="grid grid-cols-3 gap-3">
                    <div class="text-center">
                      <p class="text-xs text-gray-500">SNS</p>
                      <p class="text-lg font-bold text-blue-600">${record.sns_accuracy || 0}%</p>
                    </div>
                    <div class="text-center">
                      <p class="text-xs text-gray-500">配信</p>
                      <p class="text-lg font-bold text-green-600">${record.streaming_accuracy || 0}%</p>
                    </div>
                    <div class="text-center">
                      <p class="text-xs text-gray-500">収益</p>
                      <p class="text-lg font-bold text-amber-600">${record.revenue_accuracy || 0}%</p>
                    </div>
                  </div>
                </div>
                
                ${record.overview ? `
                  <div class="mb-3">
                    <p class="text-xs text-gray-600 mb-1">概要</p>
                    <p class="text-sm text-gray-700">${escapeHtml(record.overview)}</p>
                  </div>
                ` : ''}
                
                ${record.details ? `
                  <div class="mb-3">
                    <p class="text-xs text-gray-600 mb-1">詳細</p>
                    <p class="text-sm text-gray-700">${escapeHtml(record.details)}</p>
                  </div>
                ` : ''}
                
                ${record.error_message ? `
                  <div class="mt-3 p-2 bg-red-100 rounded border border-red-300">
                    <p class="text-xs text-red-800">
                      <i class="fas fa-exclamation-triangle mr-1"></i>
                      エラー: ${escapeHtml(record.error_message)}
                    </p>
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
        
        <div class="p-6 border-t border-gray-200 bg-gray-50">
          <button 
            onclick="this.closest('.fixed').remove()" 
            class="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition"
          >
            閉じる
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // チャートを描画（モーダルがDOMに追加された後）
    setTimeout(() => {
      renderVQDiagnosisCharts(history);
    }, 100);
    
  } catch (error) {
    console.error('生徒別履歴取得エラー:', error);
    showNotification('履歴の取得に失敗しました', 'error');
  }
}

/**
 * VQ診断のチャートを描画
 */
function renderVQDiagnosisCharts(history) {
  if (history.length === 0) return;
  
  // 最新の診断結果（一番最初の要素）
  const latest = history[0];
  
  // レーダーチャート（最新結果 - 正解率%表示）
  const radarCanvas = document.getElementById('vq-radar-chart');
  if (radarCanvas) {
    new Chart(radarCanvas, {
      type: 'radar',
      data: {
        labels: ['SNS', '配信', '収益'],
        datasets: [{
          label: '正解率',
          data: [
            latest.sns_accuracy || 0,
            latest.streaming_accuracy || 0,
            latest.revenue_accuracy || 0
          ],
          backgroundColor: 'rgba(147, 51, 234, 0.2)',
          borderColor: 'rgba(147, 51, 234, 1)',
          borderWidth: 2,
          pointBackgroundColor: 'rgba(147, 51, 234, 1)',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: 'rgba(147, 51, 234, 1)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          r: {
            beginAtZero: true,
            min: 0,
            max: 100,
            ticks: {
              stepSize: 20,
              callback: function(value) {
                return value + '%';
              }
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return context.label + ': ' + context.parsed.r + '%';
              }
            }
          }
        }
      }
    });
  }
  
  // 推移グラフ（複数の診断結果がある場合のみ）
  if (history.length > 1) {
    const trendCanvas = document.getElementById('vq-trend-chart');
    if (trendCanvas) {
      // 古い順に並び替え（日付順）
      const sortedHistory = [...history].reverse();
      
      new Chart(trendCanvas, {
        type: 'line',
        data: {
          labels: sortedHistory.map((h, i) => `${i + 1}回目\n${h.diagnosis_date || ''}`),
          datasets: [
            {
              label: 'SNS',
              data: sortedHistory.map(h => h.sns_score || 0),
              borderColor: 'rgb(59, 130, 246)',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              borderWidth: 2,
              tension: 0.3
            },
            {
              label: '配信',
              data: sortedHistory.map(h => h.streaming_score || 0),
              borderColor: 'rgb(16, 185, 129)',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              borderWidth: 2,
              tension: 0.3
            },
            {
              label: '収益',
              data: sortedHistory.map(h => h.revenue_score || 0),
              borderColor: 'rgb(245, 158, 11)',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              borderWidth: 2,
              tension: 0.3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          scales: {
            y: {
              beginAtZero: true,
              min: 0,
              max: 100,
              ticks: {
                stepSize: 20
              },
              title: {
                display: true,
                text: 'スコア'
              }
            },
            x: {
              title: {
                display: true,
                text: '診断回数'
              }
            }
          },
          plugins: {
            legend: {
              display: true,
              position: 'top'
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return context.dataset.label + ': ' + context.parsed.y + '点';
                }
              }
            }
          }
        }
      });
    }
  }
}

/**
 * 手動でVQ診断をチェック
 */
async function manualCheckVQDiagnosis() {
  try {
    showNotification('チェック中...', 'info');
    
    const response = await axios.post(
      `${API_BASE}/api/vq-diagnosis/check`,
      {},
      { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    if (response.data.success) {
      const { processed, errors } = response.data;
      showNotification(
        `チェック完了: 送信 ${processed}件、エラー ${errors}件`,
        processed > 0 ? 'success' : 'info'
      );
      
      // ページを再読み込み
      if (processed > 0 || errors > 0) {
        await renderVQDiagnosisPage();
      }
    } else {
      showNotification(
        response.data.message || 'チェックに失敗しました',
        'error'
      );
    }
    
  } catch (error) {
    console.error('手動チェックエラー:', error);
    showNotification(
      error.response?.data?.error || 'チェックに失敗しました',
      'error'
    );
  }
}

/**
 * VQ診断タイプの画像設定を保存
 */
async function saveVQDiagnosisImage() {
  try {
    const diagnosisType = document.getElementById('new-diagnosis-type').value.trim();
    const imageUrl = document.getElementById('new-image-url').value.trim();
    
    if (!diagnosisType) {
      showNotification('診断タイプを入力してください', 'error');
      return;
    }
    
    if (!imageUrl) {
      showNotification('画像URLを入力してください', 'error');
      return;
    }
    
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      showNotification('有効なURLを入力してください（http:// または https:// で始まる）', 'error');
      return;
    }
    
    const response = await axios.post(
      `${API_BASE}/api/vq-diagnosis/images`,
      { diagnosis_type: diagnosisType, image_url: imageUrl },
      { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    if (response.data.success) {
      showNotification('画像設定を保存しました', 'success');
      
      // フォームをクリア
      document.getElementById('new-diagnosis-type').value = '';
      document.getElementById('new-image-url').value = '';
      
      // ページを再読み込み
      await renderVQDiagnosisPage();
    }
    
  } catch (error) {
    console.error('画像設定保存エラー:', error);
    showNotification(
      error.response?.data?.error || '画像設定の保存に失敗しました',
      'error'
    );
  }
}

/**
 * VQ診断タイプの画像設定を削除
 */
async function deleteVQDiagnosisImage(imageId) {
  try {
    if (!confirm('この画像設定を削除しますか？')) {
      return;
    }
    
    const response = await axios.delete(
      `${API_BASE}/api/vq-diagnosis/images/${imageId}`,
      { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    if (response.data.success) {
      showNotification('画像設定を削除しました', 'success');
      
      // ページを再読み込み
      await renderVQDiagnosisPage();
    }
    
  } catch (error) {
    console.error('画像設定削除エラー:', error);
    showNotification(
      error.response?.data?.error || '画像設定の削除に失敗しました',
      'error'
    );
  }
}

/**
 * VQ診断のテスト送信
 */
async function testSendVQDiagnosis() {
  try {
    const channelUrl = document.getElementById('test-channel-url').value.trim();
    const userId = document.getElementById('test-user-id').value.trim();
    
    if (!channelUrl) {
      showNotification('チャンネルURLを入力してください', 'error');
      return;
    }
    
    if (!channelUrl.startsWith('https://discord.com/channels/')) {
      showNotification('正しいDiscordチャンネルURLを入力してください\n形式: https://discord.com/channels/SERVER_ID/CHANNEL_ID', 'error');
      return;
    }
    
    showNotification('テスト送信中...', 'info');
    
    const response = await axios.post(
      `${API_BASE}/api/vq-diagnosis/test`,
      { channelUrl, userId },
      { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    if (response.data.success) {
      const data = response.data.data;
      showNotification(
        `テスト送信成功！\n` +
        `行番号: ${data.rowNumber}\n` +
        `学籍番号: ${data.studentId}\n` +
        `診断タイプ: ${data.diagnosisType}\n` +
        `合計点: ${data.totalScore}点\n` +
        `履歴: ${data.historyCount}件\n` +
        `レーダー: ${data.hasRadarChart ? 'あり' : 'なし'}\n` +
        `推移: ${data.hasTrendChart ? 'あり' : 'なし'}\n` +
        `タイプ画像: ${data.hasTypeImage ? 'あり' : 'なし'}`,
        'success'
      );
    }
    
  } catch (error) {
    console.error('テスト送信エラー:', error);
    showNotification(
      error.response?.data?.error || 'テスト送信に失敗しました',
      'error'
    );
  }
}

/**
 * VQ診断 - 単独行を再送信
 */
async function resendVQSingleRow() {
  try {
    const rowNumber = parseInt(document.getElementById('vq-single-row').value);
    
    if (!rowNumber || rowNumber < 2) {
      showNotification('2以上の行番号を入力してください', 'error');
      return;
    }
    
    if (!confirm(`行 ${rowNumber} のデータをR列の状態に関係なく再送信しますか？`)) {
      return;
    }
    
    showNotification('再送信中...', 'info');
    
    const response = await axios.post(
      `${API_BASE}/api/vq-diagnosis/resend-single-row`,
      { rowNumber },
      { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    if (response.data.success) {
      showNotification(
        `再送信成功！\n` +
        `行番号: ${response.data.data.rowNumber}\n` +
        `学籍番号: ${response.data.data.studentId}\n` +
        `生徒名: ${response.data.data.studentName}\n` +
        `診断タイプ: ${response.data.data.diagnosisType}`,
        'success'
      );
      
      // 履歴を再読み込み
      await loadVQDiagnosisData();
      await renderVQDiagnosisPage();
    }
    
  } catch (error) {
    console.error('単独行再送信エラー:', error);
    showNotification(
      error.response?.data?.error || '再送信に失敗しました',
      'error'
    );
  }
}

/**
 * VQ診断 - 範囲再送信
 */
async function resendVQFromRow() {
  try {
    const startRow = parseInt(document.getElementById('vq-start-row').value);
    
    if (!startRow || startRow < 2) {
      showNotification('2以上の行番号を入力してください', 'error');
      return;
    }
    
    if (!confirm(`行 ${startRow} から未送信のレコードを再送信しますか？\nR列が「完了」でない行だけが対象です。`)) {
      return;
    }
    
    showNotification('範囲再送信中...（完了まで数分かかる場合があります）', 'info');
    
    const response = await axios.post(
      `${API_BASE}/api/vq-diagnosis/resend-from-row`,
      { startRow },
      { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    if (response.data.success) {
      showNotification(
        `範囲再送信完了！\n` +
        `処理件数: ${response.data.data?.processed || 0}件\n` +
        `エラー件数: ${response.data.data?.errors || 0}件`,
        'success'
      );
      
      // 履歴を再読み込み
      await loadVQDiagnosisData();
      await renderVQDiagnosisPage();
    }
    
  } catch (error) {
    console.error('範囲再送信エラー:', error);
    showNotification(
      error.response?.data?.error || '範囲再送信に失敗しました',
      'error'
    );
  }
}

/**
 * VQ診断 - 履歴を削除
 */
async function deleteVQHistory(id, studentName) {
  try {
    if (!confirm(`${studentName} の履歴を削除しますか？\nこの操作は取り消せません。`)) {
      return;
    }
    
    showNotification('削除中...', 'info');
    
    const response = await axios.delete(
      `${API_BASE}/api/vq-diagnosis/history/${id}`,
      { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    if (response.data.success) {
      showNotification(`履歴を削除しました: ${studentName}`, 'success');
      
      // 履歴を再読み込み
      await loadVQDiagnosisData();
      await renderVQDiagnosisPage();
    }
    
  } catch (error) {
    console.error('履歴削除エラー:', error);
    showNotification(
      error.response?.data?.error || '履歴の削除に失敗しました',
      'error'
    );
  }
}

// ===== Today's Lessons Date Navigation =====
function changeLessonDate(days) {
  currentLessonDate.setDate(currentLessonDate.getDate() + days);
  renderTodayLessonsPage();
}

function resetToToday() {
  currentLessonDate = new Date();
  renderTodayLessonsPage();
}

// ===== Lesson Report Modal =====
function showLessonReportModal(studentId, lessonDate, studentName, tutorName) {
  // Check if report already exists
  const reportKey = `${studentId}-${lessonDate}`;
  const existingReport = lessonReportStatus[reportKey];
  
  const modal = document.createElement('div');
  modal.id = 'lessonReportModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      <div class="p-6">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-clipboard-check mr-2 text-green-600"></i>
            レッスン報告
          </h2>
          <button onclick="closeLessonReportModal()" class="text-gray-400 hover:text-gray-600 transition">
            <i class="fas fa-times text-2xl"></i>
          </button>
        </div>
        
        <div class="mb-6 p-4 bg-blue-50 rounded-lg">
          <p class="text-sm text-gray-600">学籍番号: <span class="font-semibold">${studentId}</span></p>
          <p class="text-sm text-gray-600">生徒名: <span class="font-semibold">${studentName}</span></p>
          <p class="text-sm text-gray-600">担任Tutor: <span class="font-semibold">${tutorName}</span></p>
          <p class="text-sm text-gray-600">レッスン日: <span class="font-semibold">${lessonDate}</span></p>
        </div>
        
        <form id="lessonReportForm" class="space-y-6">
          <!-- レッスン結果 -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">
              レッスン結果 <span class="text-red-600">*</span>
            </label>
            <select id="lessonResult" required class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
              <option value="">選択してください</option>
              <option value="実施済み">実施済み</option>
              <option value="生徒様都合でリスケ">生徒様都合でリスケ</option>
              <option value="Tutor都合でリスケ">Tutor都合でリスケ</option>
              <option value="無断キャンセル">無断キャンセル</option>
            </select>
          </div>
          
          <!-- レッスン番号 -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">
              レッスン番号 <span class="text-red-600">*</span>
            </label>
            <select id="lessonNumber" required onchange="toggleProFields()" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
              <option value="">選択してください</option>
              ${Array.from({length: 28}, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
              <option value="PROプラン">PROプラン</option>
            </select>
          </div>
          
          <!-- PROプラン専用フィールド -->
          <div id="proFields" class="hidden space-y-6">
            <!-- カリキュラム -->
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">
                カリキュラム <span class="text-red-600">*</span>
              </label>
              <select id="proCurriculum" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
                <option value="">選択してください</option>
                <option value="【収益の最大化】YouTubeマネタイズ戦略">【収益の最大化】YouTubeマネタイズ戦略</option>
                <option value="【V体質化】 収益を生むグッズ販売戦略">【V体質化】 収益を生むグッズ販売戦略</option>
                <option value="【プロの登竜門】安定的な企業案件獲得術">【プロの登竜門】安定的な企業案件獲得術</option>
                <option value="【急成長】YouTubeバズコンテンツ量産術">【急成長】YouTubeバズコンテンツ量産術</option>
                <option value="【特化スキル】動画編集コース（標準編）">【特化スキル】動画編集コース（標準編）</option>
                <option value="【特化スキル】動画編集コース（アドバンス編）">【特化スキル】動画編集コース（アドバンス編）</option>
                <option value="【好きなことを極める】YouTube活動「伸び」の再設計図">【好きなことを極める】YouTube活動「伸び」の再設計図</option>
              </select>
            </div>
            
            <!-- テキスト番号 -->
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">
                テキスト番号 <span class="text-red-600">*</span>
              </label>
              <select id="proTextNumber" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
                <option value="">選択してください</option>
                ${Array.from({length: 12}, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
              </select>
            </div>
          </div>
          
          <!-- ボタン -->
          <div class="flex gap-3 pt-4">
            <button type="button" onclick="closeLessonReportModal()" class="flex-1 px-6 py-3 bg-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-400 transition">
              キャンセル
            </button>
            <button type="submit" class="flex-1 px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition">
              <i class="fas fa-save mr-2"></i>保存
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Load existing data if available
  if (existingReport) {
    document.getElementById('lessonResult').value = existingReport.lesson_result || '';
    document.getElementById('lessonNumber').value = existingReport.lesson_number || '';
    
    if (existingReport.lesson_number === 'PROプラン') {
      document.getElementById('proCurriculum').value = existingReport.pro_curriculum || '';
      document.getElementById('proTextNumber').value = existingReport.pro_text_number || '';
      toggleProFields();
    }
  }
  
  // フォーム送信処理
  document.getElementById('lessonReportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitLessonReport(studentId, lessonDate, tutorName);
  });
}

function toggleProFields() {
  const lessonNumber = document.getElementById('lessonNumber').value;
  const proFields = document.getElementById('proFields');
  const proCurriculum = document.getElementById('proCurriculum');
  const proTextNumber = document.getElementById('proTextNumber');
  
  if (lessonNumber === 'PROプラン') {
    proFields.classList.remove('hidden');
    proCurriculum.required = true;
    proTextNumber.required = true;
  } else {
    proFields.classList.add('hidden');
    proCurriculum.required = false;
    proTextNumber.required = false;
    proCurriculum.value = '';
    proTextNumber.value = '';
  }
}

function closeLessonReportModal() {
  const modal = document.getElementById('lessonReportModal');
  if (modal) {
    modal.remove();
  }
}

async function submitLessonReport(studentId, lessonDate, tutorName) {
  try {
    const lessonResult = document.getElementById('lessonResult').value;
    const lessonNumber = document.getElementById('lessonNumber').value;
    const proCurriculum = document.getElementById('proCurriculum').value;
    const proTextNumber = document.getElementById('proTextNumber').value;
    
    // バリデーション
    if (!lessonResult || !lessonNumber) {
      showNotification('必須項目を入力してください', 'error');
      return;
    }
    
    if (lessonNumber === 'PROプラン' && (!proCurriculum || !proTextNumber)) {
      showNotification('PROプランの場合、カリキュラムとテキスト番号を選択してください', 'error');
      return;
    }
    
    // API送信
    const response = await axios.post(`${API_BASE}/api/lesson-reports`, {
      student_id: studentId,
      lesson_date: lessonDate,
      lesson_result: lessonResult,
      lesson_number: lessonNumber,
      pro_curriculum: proCurriculum || null,
      pro_text_number: proTextNumber || null,
      reported_by: currentUser?.email || 'unknown',
      tutor_name: tutorName || null
    }, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      }
    });
    
    if (response.data.success) {
      showNotification('レッスン報告を保存しました', 'success');
      
      // Update lesson report status cache
      const reportKey = `${studentId}-${lessonDate}`;
      lessonReportStatus[reportKey] = response.data.data;
      
      closeLessonReportModal();
      
      // Reload the page to update button status
      await renderTodayLessonsPage();
    } else {
      showNotification('保存に失敗しました: ' + response.data.error, 'error');
    }
  } catch (error) {
    console.error('レッスン報告送信エラー:', error);
    showNotification(
      error.response?.data?.error || 'レッスン報告の保存に失敗しました',
      'error'
    );
  }
}

// ==========================================
// レッスン報告閲覧ページ
// ==========================================

// レッスン報告の検索フィルター状態
let reportFilters = {
  start_date: '',
  end_date: '',
  student_id: '',
  tutor_name: '',
  lesson_result: ''
};
let reportCurrentPage = 0;
const reportPageSize = 50;

async function renderLessonReportsPage() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  
  const content = document.getElementById('content');
  
  // 権限チェック
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'leader')) {
    content.innerHTML = `
      <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
        <strong class="font-bold">アクセス権限がありません</strong>
        <span class="block sm:inline">このページはリーダー以上の権限が必要です。</span>
      </div>
    `;
    return;
  }
  
  content.innerHTML = `
    <div class="space-y-6">
      <!-- Header -->
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-2xl font-bold text-gray-800 mb-4">
          <i class="fas fa-clipboard-list mr-2"></i>レッスン報告閲覧
        </h2>
        
        <!-- Search Filters -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <!-- 日付範囲 -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">開始日</label>
            <input type="date" id="filter-start-date" 
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value="${reportFilters.start_date}">
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">終了日</label>
            <input type="date" id="filter-end-date" 
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value="${reportFilters.end_date}">
          </div>
          
          <!-- 学籍番号 -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">学籍番号</label>
            <input type="text" id="filter-student-id" 
              placeholder="部分一致検索"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value="${reportFilters.student_id}">
          </div>
          
          <!-- Tutor名 -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">担当Tutor</label>
            <input type="text" id="filter-tutor-name" 
              placeholder="部分一致検索"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              value="${reportFilters.tutor_name}">
          </div>
          
          <!-- レッスン結果 -->
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">レッスン結果</label>
            <select id="filter-lesson-result" 
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">すべて</option>
              <option value="実施済み" ${reportFilters.lesson_result === '実施済み' ? 'selected' : ''}>実施済み</option>
              <option value="生徒様都合でリスケ" ${reportFilters.lesson_result === '生徒様都合でリスケ' ? 'selected' : ''}>生徒様都合でリスケ</option>
              <option value="Tutor都合でリスケ" ${reportFilters.lesson_result === 'Tutor都合でリスケ' ? 'selected' : ''}>Tutor都合でリスケ</option>
              <option value="無断キャンセル" ${reportFilters.lesson_result === '無断キャンセル' ? 'selected' : ''}>無断キャンセル</option>
            </select>
          </div>
          
          <!-- 検索ボタン -->
          <div class="flex items-end">
            <button onclick="searchLessonReports()" 
              class="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              <i class="fas fa-search mr-2"></i>検索
            </button>
          </div>
        </div>
        
        <!-- クイックフィルター -->
        <div class="flex gap-2 flex-wrap">
          <button onclick="setQuickFilter('today')" 
            class="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded transition">
            今日
          </button>
          <button onclick="setQuickFilter('week')" 
            class="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded transition">
            今週
          </button>
          <button onclick="setQuickFilter('month')" 
            class="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded transition">
            今月
          </button>
          <button onclick="clearReportFilters()" 
            class="px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded transition">
            <i class="fas fa-times mr-1"></i>フィルタークリア
          </button>
        </div>
      </div>
      
      <!-- Results -->
      <div id="lesson-reports-results" class="bg-white rounded-lg shadow-md p-6">
        <div class="flex justify-center items-center py-8">
          <i class="fas fa-spinner fa-spin text-gray-400 text-3xl"></i>
        </div>
      </div>
    </div>
  `;
  
  // イベントリスナー設定
  document.getElementById('filter-start-date').addEventListener('change', (e) => {
    reportFilters.start_date = e.target.value;
  });
  document.getElementById('filter-end-date').addEventListener('change', (e) => {
    reportFilters.end_date = e.target.value;
  });
  document.getElementById('filter-student-id').addEventListener('input', (e) => {
    reportFilters.student_id = e.target.value;
  });
  document.getElementById('filter-tutor-name').addEventListener('input', (e) => {
    reportFilters.tutor_name = e.target.value;
  });
  document.getElementById('filter-lesson-result').addEventListener('change', (e) => {
    reportFilters.lesson_result = e.target.value;
  });
  
  // 初回検索実行
  await searchLessonReports();
}

async function searchLessonReports(page = 0) {
  reportCurrentPage = page;
  const resultsContainer = document.getElementById('lesson-reports-results');
  
  resultsContainer.innerHTML = `
    <div class="flex justify-center items-center py-8">
      <i class="fas fa-spinner fa-spin text-gray-400 text-3xl"></i>
    </div>
  `;
  
  try {
    const params = new URLSearchParams({
      limit: reportPageSize,
      offset: page * reportPageSize
    });
    
    if (reportFilters.start_date) params.append('start_date', reportFilters.start_date);
    if (reportFilters.end_date) params.append('end_date', reportFilters.end_date);
    if (reportFilters.student_id) params.append('student_id', reportFilters.student_id);
    if (reportFilters.tutor_name) params.append('tutor_name', reportFilters.tutor_name);
    if (reportFilters.lesson_result) params.append('lesson_result', reportFilters.lesson_result);
    
    const response = await axios.get(`${API_BASE}/api/lesson-reports?${params.toString()}`);
    
    if (response.data.success) {
      renderLessonReportsTable(response.data);
    } else {
      throw new Error(response.data.error);
    }
  } catch (error) {
    console.error('レッスン報告取得エラー:', error);
    resultsContainer.innerHTML = `
      <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        <p class="font-bold">エラーが発生しました</p>
        <p class="text-sm">${error.message}</p>
      </div>
    `;
  }
}

function renderLessonReportsTable(data) {
  const resultsContainer = document.getElementById('lesson-reports-results');
  const { data: reports, count, total, limit, offset } = data;
  
  if (reports.length === 0) {
    resultsContainer.innerHTML = `
      <div class="text-center py-8 text-gray-500">
        <i class="fas fa-inbox text-4xl mb-2"></i>
        <p>該当するレッスン報告がありません</p>
      </div>
    `;
    return;
  }
  
  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit);
  
  resultsContainer.innerHTML = `
    <!-- Summary -->
    <div class="mb-4 text-sm text-gray-600">
      検索結果: ${total}件中 ${offset + 1}～${Math.min(offset + count, total)}件を表示
    </div>
    
    <!-- Table -->
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン日</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">学籍番号</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">生徒名</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">担当Tutor</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン結果</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン番号</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PROプラン</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">報告者</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">報告日時</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          ${reports.map(report => renderLessonReportRow(report)).join('')}
        </tbody>
      </table>
    </div>
    
    <!-- Pagination -->
    ${totalPages > 1 ? `
      <div class="mt-4 flex justify-center items-center gap-2">
        <button 
          onclick="searchLessonReports(${currentPage - 1})"
          ${currentPage === 0 ? 'disabled' : ''}
          class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 transition disabled:opacity-50 disabled:cursor-not-allowed">
          <i class="fas fa-chevron-left"></i>
        </button>
        
        <span class="px-4 py-1 text-sm text-gray-700">
          ${currentPage + 1} / ${totalPages}
        </span>
        
        <button 
          onclick="searchLessonReports(${currentPage + 1})"
          ${currentPage >= totalPages - 1 ? 'disabled' : ''}
          class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 transition disabled:opacity-50 disabled:cursor-not-allowed">
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    ` : ''}
  `;
}

function renderLessonReportRow(report) {
  const lessonResultClass = {
    '実施済み': 'bg-green-100 text-green-800',
    '生徒様都合でリスケ': 'bg-yellow-100 text-yellow-800',
    'Tutor都合でリスケ': 'bg-orange-100 text-orange-800',
    '無断キャンセル': 'bg-red-100 text-red-800'
  }[report.lesson_result] || 'bg-gray-100 text-gray-800';
  
  const proInfo = report.lesson_number === 'PROプラン' 
    ? `${report.pro_curriculum || '-'}<br><span class="text-xs">テキスト${report.pro_text_number || '-'}</span>`
    : '-';
  
  return `
    <tr class="hover:bg-gray-50">
      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${report.lesson_date}</td>
      <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${report.student_id}</td>
      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${report.student_name || '-'}</td>
      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${report.tutor_name || '-'}</td>
      <td class="px-4 py-3 whitespace-nowrap text-sm">
        <span class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${lessonResultClass}">
          ${report.lesson_result}
        </span>
      </td>
      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${report.lesson_number}</td>
      <td class="px-4 py-3 text-sm text-gray-600">${proInfo}</td>
      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${report.reported_by || '-'}</td>
      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
        ${new Date(report.reported_at).toLocaleString('ja-JP')}
      </td>
    </tr>
  `;
}

function setQuickFilter(type) {
  const today = new Date();
  const startDate = new Date();
  
  switch (type) {
    case 'today':
      reportFilters.start_date = formatDateToYYYYMMDD(today);
      reportFilters.end_date = formatDateToYYYYMMDD(today);
      break;
    case 'week':
      const dayOfWeek = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
      reportFilters.start_date = formatDateToYYYYMMDD(monday);
      reportFilters.end_date = formatDateToYYYYMMDD(today);
      break;
    case 'month':
      startDate.setDate(1);
      reportFilters.start_date = formatDateToYYYYMMDD(startDate);
      reportFilters.end_date = formatDateToYYYYMMDD(today);
      break;
  }
  
  document.getElementById('filter-start-date').value = reportFilters.start_date;
  document.getElementById('filter-end-date').value = reportFilters.end_date;
  
  searchLessonReports();
}

function clearReportFilters() {
  reportFilters = {
    start_date: '',
    end_date: '',
    student_id: '',
    tutor_name: '',
    lesson_result: ''
  };
  
  document.getElementById('filter-start-date').value = '';
  document.getElementById('filter-end-date').value = '';
  document.getElementById('filter-student-id').value = '';
  document.getElementById('filter-tutor-name').value = '';
  document.getElementById('filter-lesson-result').value = '';
  
  searchLessonReports();
}

function formatDateToYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ===== Roulette Winners Page =====

async function renderRouletteWinnersPage() {
  // Permission check
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'leader')) {
    content.innerHTML = `
      <div class="bg-white rounded-lg shadow-md p-8 text-center">
        <i class="fas fa-lock text-6xl text-red-500 mb-4"></i>
        <h2 class="text-2xl font-bold text-gray-800 mb-2">アクセス権限がありません</h2>
        <p class="text-gray-600">このページはリーダー以上の権限が必要です。</p>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="space-y-6">
      <!-- Page Header -->
      <div class="bg-gradient-to-r from-yellow-500 to-orange-600 rounded-lg shadow-lg p-6 text-white">
        <h1 class="text-3xl font-bold flex items-center gap-3">
          <i class="fas fa-trophy"></i>
          ルーレット特典送付済み一覧
        </h1>
        <p class="mt-2 text-yellow-100">
          アンケートスタンプラリーの特典を送付した生徒様の一覧です
        </p>
      </div>

      <!-- Tabs -->
      <div class="bg-white rounded-lg shadow-md">
        <div class="border-b border-gray-200">
          <nav class="flex -mb-px">
            <button onclick="switchRouletteTab('winners')" id="tab-winners" class="roulette-tab px-6 py-3 text-sm font-medium border-b-2 border-yellow-500 text-yellow-600">
              <i class="fas fa-trophy mr-2"></i>
              当たり生徒
            </button>
            <button onclick="switchRouletteTab('completed')" id="tab-completed" class="roulette-tab px-6 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">
              <i class="fas fa-check-circle mr-2"></i>
              実施済み
            </button>
            <button onclick="switchRouletteTab('losers')" id="tab-losers" class="roulette-tab px-6 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">
              <i class="fas fa-times-circle mr-2"></i>
              はずれ生徒
            </button>
            <button onclick="switchRouletteTab('unopened')" id="tab-unopened" class="roulette-tab px-6 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">
              <i class="fas fa-envelope mr-2"></i>
              未開封
            </button>
            <button onclick="switchRouletteTab('template')" id="tab-template" class="roulette-tab px-6 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">
              <i class="fas fa-file-alt mr-2"></i>
              メールテンプレート
            </button>
          </nav>
        </div>

        <!-- Loading State -->
        <div id="roulette-loading" class="p-12 text-center">
          <i class="fas fa-spinner fa-spin text-4xl text-blue-600 mb-4"></i>
          <p class="text-gray-600">データを読み込み中...</p>
        </div>

        <!-- Filter and Sort Controls -->
        <div id="roulette-filters" class="hidden p-4 bg-gray-50 border-b border-gray-200">
          <div class="flex flex-wrap gap-4 items-end">
            <!-- Filter Section -->
            <div class="flex-1 min-w-[200px]">
              <label class="block text-xs font-medium text-gray-700 mb-1">
                <i class="fas fa-filter mr-1"></i>フィルター
              </label>
              <div class="flex gap-2">
                <!-- Status Filter (Winners only) -->
                <select id="filter-status" class="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent" onchange="applyRouletteFilters()">
                  <option value="">すべての対応状況</option>
                  <option value="未連絡">未連絡</option>
                  <option value="連絡済み">連絡済み</option>
                  <option value="予約あり">予約あり</option>
                  <option value="実施済み">実施済み</option>
                </select>
                
                <!-- Staff Filter (Winners only) -->
                <select id="filter-staff" class="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent" onchange="applyRouletteFilters()">
                  <option value="">すべての担当者</option>
                  <option value="未割当">未割当</option>
                </select>
                
                <!-- Tutor Filter -->
                <select id="filter-tutor" class="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent" onchange="applyRouletteFilters()">
                  <option value="">すべてのTutor</option>
                </select>
              </div>
            </div>
            
            <!-- Sort Section -->
            <div class="flex-1 min-w-[200px]">
              <label class="block text-xs font-medium text-gray-700 mb-1">
                <i class="fas fa-sort mr-1"></i>ソート
              </label>
              <div class="flex gap-2">
                <select id="sort-field" class="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent" onchange="applyRouletteFilters()">
                  <option value="drawnAt">日時</option>
                  <option value="studentName">生徒名</option>
                  <option value="continuedMonths">継続月数</option>
                  <option value="probability">確率</option>
                  <option value="status">対応状況</option>
                </select>
                
                <select id="sort-order" class="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent" onchange="applyRouletteFilters()">
                  <option value="desc">降順</option>
                  <option value="asc">昇順</option>
                </select>
              </div>
            </div>
            
            <!-- Search Section -->
            <div class="flex-1 min-w-[200px]">
              <label class="block text-xs font-medium text-gray-700 mb-1">
                <i class="fas fa-search mr-1"></i>検索
              </label>
              <input 
                type="text" 
                id="search-student" 
                placeholder="生徒名または学籍番号"
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                onkeyup="applyRouletteFilters()"
              >
            </div>
            
            <!-- Reset Button -->
            <div>
              <button 
                onclick="resetRouletteFilters()"
                class="px-4 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition"
              >
                <i class="fas fa-redo mr-1"></i>リセット
              </button>
            </div>
          </div>
        </div>

        <!-- Content Area -->
        <div id="roulette-content" class="hidden p-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold text-gray-800">
              <i class="fas fa-list mr-2"></i>
              <span id="roulette-list-title">当たり生徒一覧</span>
            </h2>
            <div class="text-sm text-gray-600">
              表示: <span id="roulette-filtered-count" class="font-bold text-blue-600">0</span>名 / 
              全体: <span id="roulette-count" class="font-bold text-gray-600">0</span>名
            </div>
          </div>
          
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr id="roulette-table-header">
                  <!-- Headers will be inserted dynamically -->
                </tr>
              </thead>
              <tbody id="roulette-table-body" class="bg-white divide-y divide-gray-200">
                <!-- Rows will be inserted here -->
              </tbody>
            </table>
          </div>
        </div>
        
        <!-- Email Template Content -->
        <div id="template-content" class="hidden p-6">
          <div class="max-w-3xl mx-auto">
            <div class="flex justify-between items-center mb-6">
              <h2 class="text-xl font-bold text-gray-800">
                <i class="fas fa-file-alt mr-2"></i>
                当選者向けメールテンプレート
              </h2>
              <button 
                onclick="copyEmailTemplate()"
                class="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition shadow-md"
              >
                <i class="fas fa-copy mr-2"></i>
                コピー
              </button>
            </div>
            
            <div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border-2 border-blue-200 p-8 relative">
              <div class="absolute top-4 right-4">
                <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-600 text-white">
                  <i class="fas fa-envelope mr-1"></i>
                  テンプレート
                </span>
              </div>
              
              <div id="email-template-text" class="prose prose-sm max-w-none">
                <div class="whitespace-pre-wrap font-sans text-gray-800 leading-relaxed" style="font-size: 15px;">お世話になっております！
スタンプラリー特典の当選おめでとうございます🎉 

<strong>特典として「弊社事務所マネージャーによる1時間コンサル権」を贈呈します！</strong>

つきましては下記URLよりコンサルのご予約をお取りください！
URL：○○

今月の予約が難しい場合は来月でも問題ございません！
ただし、<strong>3か月が経過すると権利が消失</strong>してしまいますのでご注意ください！</div>
              </div>
              
              <div class="mt-6 pt-6 border-t border-blue-200">
                <div class="flex items-start gap-3 text-sm text-gray-600">
                  <i class="fas fa-info-circle text-blue-500 mt-1"></i>
                  <div>
                    <p class="font-semibold text-gray-700 mb-1">使い方</p>
                    <ul class="space-y-1 text-xs">
                      <li>• 「コピー」ボタンでテンプレート全体をコピーできます</li>
                      <li>• 「URL：○○」の部分を実際の予約URLに置き換えてください</li>
                      <li>• 必要に応じて文面をカスタマイズしてください</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Load winners data by default
  window.currentRouletteTab = 'winners';
  await loadRouletteData('winners');
}

// Switch between roulette tabs
function switchRouletteTab(tab) {
  // Update tab styles
  document.querySelectorAll('.roulette-tab').forEach(btn => {
    btn.classList.remove('border-yellow-500', 'text-yellow-600');
    btn.classList.add('border-transparent', 'text-gray-500');
  });
  
  const activeTab = document.getElementById(`tab-${tab}`);
  if (activeTab) {
    activeTab.classList.remove('border-transparent', 'text-gray-500');
    activeTab.classList.add('border-yellow-500', 'text-yellow-600');
  }
  
  window.currentRouletteTab = tab;
  
  // Reset filters when switching tabs
  const searchInput = document.getElementById('search-student');
  if (searchInput) searchInput.value = '';
  
  // Show template content directly without loading data
  if (tab === 'template') {
    const loadingEl = document.getElementById('roulette-loading');
    const contentEl = document.getElementById('roulette-content');
    const templateEl = document.getElementById('template-content');
    const filtersEl = document.getElementById('roulette-filters');
    
    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.add('hidden');
    if (filtersEl) filtersEl.classList.add('hidden');
    if (templateEl) templateEl.classList.remove('hidden');
  } else {
    const templateEl = document.getElementById('template-content');
    if (templateEl) templateEl.classList.add('hidden');
    loadRouletteData(tab);
  }
}

// Load roulette data based on tab
async function loadRouletteData(tab) {
  try {
    const loadingEl = document.getElementById('roulette-loading');
    const contentEl = document.getElementById('roulette-content');
    const templateEl = document.getElementById('template-content');
    
    loadingEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    if (templateEl) templateEl.classList.add('hidden');
    
    // Load consultation staff list if viewing winners or completed tab
    if ((tab === 'winners' || tab === 'completed') && !window.consultationStaffList) {
      try {
        const staffResponse = await axios.get(`${API_BASE}/api/users/consultation-staff`);
        if (staffResponse.data.success) {
          window.consultationStaffList = staffResponse.data.data;
          console.log('[Roulette] Loaded consultation staff:', window.consultationStaffList);
        }
      } catch (error) {
        console.error('[Roulette] Error loading consultation staff:', error);
        window.consultationStaffList = [];
      }
    }
    
    let endpoint = '';
    let title = '';
    
    if (tab === 'winners') {
      endpoint = '/api/roulette/winners?tab=winners';
      title = '当たり生徒一覧';
    } else if (tab === 'completed') {
      endpoint = '/api/roulette/winners?tab=completed';
      title = '実施済み一覧';
    } else if (tab === 'losers') {
      endpoint = '/api/roulette/losers';
      title = 'はずれ生徒一覧';
    } else if (tab === 'unopened') {
      endpoint = '/api/roulette/unopened';
      title = '未開封一覧';
    }
    
    const response = await axios.get(`${API_BASE}${endpoint}`);
    
    if (!response.data.success) {
      showNotification('データの読み込みに失敗しました', 'error');
      return;
    }

    const data = response.data.data;
    console.log(`✅ Loaded ${data.length} records for ${tab}`);
    
    // Store data globally for filtering
    window.currentRouletteData = data;
    window.currentRouletteRawData = data;

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
    
    // Show/hide filters based on tab
    const filtersEl = document.getElementById('roulette-filters');
    if (filtersEl) {
      if (tab === 'winners' || tab === 'completed' || tab === 'losers' || tab === 'unopened') {
        filtersEl.classList.remove('hidden');
        
        // Populate tutor filter
        const tutorFilter = document.getElementById('filter-tutor');
        if (tutorFilter) {
          const uniqueTutors = [...new Set(data.map(row => row.homeroom_tutor).filter(t => t))].sort();
          tutorFilter.innerHTML = '<option value="">すべてのTutor</option>' +
            uniqueTutors.map(tutor => `<option value="${tutor}">${getTutorDisplayName(tutor)}</option>`).join('');
        }
        
        // Populate staff filter for winners and completed
        if (tab === 'winners' || tab === 'completed') {
          const staffFilter = document.getElementById('filter-staff');
          if (staffFilter && window.consultationStaffList) {
            staffFilter.innerHTML = '<option value="">すべての担当者</option><option value="未割当">未割当</option>' +
              window.consultationStaffList.map(staff => `<option value="${staff}">${staff}</option>`).join('');
          }
          
          // Show status and staff filters
          document.getElementById('filter-status')?.parentElement?.classList.remove('hidden');
          document.getElementById('filter-staff')?.parentElement?.classList.remove('hidden');
        } else {
          // Hide status and staff filters for non-winners/completed
          document.getElementById('filter-status')?.parentElement?.classList.add('hidden');
          document.getElementById('filter-staff')?.parentElement?.classList.add('hidden');
        }
      } else {
        filtersEl.classList.add('hidden');
      }
    }
    
    document.getElementById('roulette-list-title').textContent = title;
    document.getElementById('roulette-count').textContent = data.length;
    document.getElementById('roulette-filtered-count').textContent = data.length;

    renderRouletteTable(tab, data);

  } catch (error) {
    console.error('❌ Error loading roulette data:', error);
    showNotification('データの読み込みに失敗しました', 'error');
    
    const loadingEl = document.getElementById('roulette-loading');
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="text-center text-red-600">
          <i class="fas fa-exclamation-circle text-4xl mb-4"></i>
          <p class="font-semibold">データの読み込みに失敗しました</p>
          <p class="text-sm mt-2">${error.message}</p>
        </div>
      `;
    }
  }
}

// Render roulette table based on tab type
function renderRouletteTable(tab, data) {
  const tableHeader = document.getElementById('roulette-table-header');
  const tableBody = document.getElementById('roulette-table-body');
  
  // Common headers
  let headers = `
    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日時</th>
    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">学籍番号</th>
    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">生徒名</th>
    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">担任Tutor</th>
    <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">継続月数</th>
    <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">達成条件</th>
    <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">確率</th>
  `;
  
  // Add consultation fields only for winners tab
  if (tab === 'winners') {
    headers += `
      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">コンサル担当</th>
      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">対応状況</th>
    `;
  }
  
  // Add consultation fields + completion date for completed tab
  if (tab === 'completed') {
    headers += `
      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">コンサル担当</th>
      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">対応状況</th>
      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">実施日</th>
    `;
  }
  
  headers += `
    <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Discord</th>
    <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Notion</th>
  `;
  
  tableHeader.innerHTML = headers;
  
  if (data.length === 0) {
    const emptyMessage = tab === 'winners' ? 'まだ当たり生徒はいません' :
                        tab === 'completed' ? 'まだ実施済みの生徒はいません' :
                        tab === 'losers' ? 'まだはずれ生徒はいません' :
                        'まだ未開封の生徒はいません';
    const colspan = tab === 'winners' ? 12 : tab === 'completed' ? 13 : 10;
    tableBody.innerHTML = `
      <tr>
        <td colspan="${colspan}" class="px-4 py-8 text-center text-gray-500">
          <i class="fas fa-inbox text-4xl mb-2"></i>
          <p>${emptyMessage}</p>
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = data.map(row => {
    const date = new Date(tab === 'unopened' ? row.notifiedAt : row.drawnAt);
    const dateStr = date.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Achievement type label
    const achievementTypeLabel = {
      'initial_1': '条件①(80%)',
      'initial_2': '条件②(6連続)',
      'initial_3': '条件③(100%)',
      'reset_6': 'リセット後',
      'initial_80': '条件①(80%)',
      'continuous_6': '条件②(6連続)',
      'catch_up_100': '条件③(100%)'
    }[row.achievementType] || row.achievementType || '-';

    const rowClass = tab === 'winners' ? 'hover:bg-yellow-50' :
                     tab === 'losers' ? 'hover:bg-gray-50' :
                     'hover:bg-blue-50';

    let rowHtml = `
      <tr class="${rowClass}">
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
          ${dateStr}
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
          ${row.studentId}
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
          ${row.studentName}
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
          ${getTutorDisplayName(row.homeroom_tutor) || '-'}
        </td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center">
          <span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800">
            ${row.continuedMonths || 0}ヶ月
          </span>
        </td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center">
          <span class="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
            ${achievementTypeLabel}
          </span>
        </td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold text-purple-600">
          ${row.probability}%
        </td>
    `;
    
    // Add consultation fields only for winners tab
    if (tab === 'winners') {
      rowHtml += `
        <td class="px-4 py-3 whitespace-nowrap text-sm">
          <select 
            class="consultation-staff-select w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
            data-id="${row.id}"
            onchange="updateWinnerField(${row.id}, 'consultationStaff', this.value)"
          >
            <option value="">選択してください</option>
            ${window.consultationStaffList ? window.consultationStaffList.map(staff => 
              `<option value="${staff}" ${row.consultationStaff === staff ? 'selected' : ''}>${staff}</option>`
            ).join('') : ''}
          </select>
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm">
          <select 
            class="status-select w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-yellow-500 focus:border-transparent ${row.status === '未連絡' ? 'font-bold text-red-600' : row.status === '連絡済み' ? 'font-bold text-orange-600' : ''}"
            data-id="${row.id}"
            onchange="updateWinnerField(${row.id}, 'status', this.value)"
          >
            <option value="未連絡" ${row.status === '未連絡' ? 'selected' : ''}>未連絡</option>
            <option value="連絡済み" ${row.status === '連絡済み' ? 'selected' : ''}>連絡済み</option>
            <option value="予約あり" ${row.status === '予約あり' ? 'selected' : ''}>予約あり</option>
            <option value="実施済み" ${row.status === '実施済み' ? 'selected' : ''}>実施済み</option>
          </select>
        </td>
      `;
    }
    
    // Add consultation fields + completion date for completed tab
    if (tab === 'completed') {
      // Format completed_at for datetime-local input (YYYY-MM-DDTHH:mm)
      let completedDateValue = '';
      if (row.completedAt) {
        const date = new Date(row.completedAt);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        completedDateValue = `${year}-${month}-${day}T${hours}:${minutes}`;
      }
      
      rowHtml += `
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
          ${row.consultationStaff || '-'}
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm">
          <span class="inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
            <i class="fas fa-check-circle mr-1"></i>
            実施済み
          </span>
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm">
          <input 
            type="datetime-local" 
            class="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
            value="${completedDateValue}"
            onchange="updateWinnerCompletedDate(${row.id}, this.value)"
            title="実施日時を手入力できます"
          />
        </td>
      `;
    }
    
    rowHtml += `
        <td class="px-3 py-3 whitespace-nowrap text-center">
          ${row.discordUrl ? `
            <a href="${row.discordUrl}" target="_blank" rel="noopener noreferrer" 
               class="inline-flex items-center px-3 py-1 bg-indigo-600 text-white text-xs font-semibold rounded hover:bg-indigo-700 transition">
              <i class="fab fa-discord mr-1"></i>Discord
            </a>
          ` : '<span class="text-gray-400 text-xs">-</span>'}
        </td>
        <td class="px-3 py-3 whitespace-nowrap text-center">
          ${row.notionUrl ? `
            <a href="${row.notionUrl}" target="_blank" rel="noopener noreferrer" 
               class="inline-flex items-center px-3 py-1 bg-gray-800 text-white text-xs font-semibold rounded hover:bg-gray-900 transition">
              <i class="fas fa-file-alt mr-1"></i>Notion
            </a>
          ` : '<span class="text-gray-400 text-xs">-</span>'}
        </td>
      </tr>
    `;
    
    return rowHtml;
  }).join('');
}

/**
 * Update winner consultation staff or status
 */
async function updateWinnerField(id, field, value) {
  try {
    const payload = {};
    payload[field] = value;
    
    const response = await axios.patch(`${API_BASE}/api/roulette/winners/${id}`, payload);
    
    if (response.data.success) {
      showNotification('更新しました', 'success');
      console.log(`[Roulette] Updated winner ${id} ${field}:`, value);
      
      // If status changed to '実施済み', reload the current tab to move the record
      if (field === 'status' && value === '実施済み') {
        console.log('[Roulette] Status changed to 実施済み, reloading tab...');
        setTimeout(() => {
          loadRouletteData(window.currentRouletteTab || 'winners');
        }, 500);
        return;
      }
      
      // Update select style if status changed (but not to 実施済み)
      if (field === 'status') {
        const selectElement = document.querySelector(`select.status-select[data-id="${id}"]`);
        if (selectElement) {
          // Remove all status color classes
          selectElement.classList.remove('font-bold', 'text-red-600', 'text-orange-600');
          
          // Add appropriate color class based on new value
          if (value === '未連絡') {
            selectElement.classList.add('font-bold', 'text-red-600');
          } else if (value === '連絡済み') {
            selectElement.classList.add('font-bold', 'text-orange-600');
          }
        }
      }
    } else {
      showNotification('更新に失敗しました', 'error');
      // Reload to revert changes
      loadRouletteData(window.currentRouletteTab || 'winners');
    }
  } catch (error) {
    console.error(`[Roulette] Error updating winner ${field}:`, error);
    showNotification('更新に失敗しました', 'error');
    // Reload to revert changes
    loadRouletteData(window.currentRouletteTab || 'winners');
  }
}

/**
 * Update winner completed date (for completed tab)
 */
async function updateWinnerCompletedDate(id, datetimeValue) {
  try {
    if (!datetimeValue) {
      showNotification('日時を入力してください', 'error');
      return;
    }
    
    // Convert datetime-local value to ISO string
    const completedAt = new Date(datetimeValue).toISOString();
    
    const response = await axios.patch(`${API_BASE}/api/roulette/winners/${id}`, {
      completedAt
    });
    
    if (response.data.success) {
      showNotification('実施日を更新しました', 'success');
      console.log(`[Roulette] Updated winner ${id} completed_at:`, completedAt);
    } else {
      showNotification('更新に失敗しました', 'error');
      // Reload to revert changes
      loadRouletteData('completed');
    }
  } catch (error) {
    console.error(`[Roulette] Error updating completed date:`, error);
    showNotification('更新に失敗しました', 'error');
    // Reload to revert changes
    loadRouletteData('completed');
  }
}

/**
 * Copy email template to clipboard
 */
async function copyEmailTemplate() {
  const templateText = `お世話になっております！
スタンプラリー特典の当選おめでとうございます🎉 

特典として「弊社事務所マネージャーによる1時間コンサル権」を贈呈します！

つきましては下記URLよりコンサルのご予約をお取りください！
URL：○○

今月の予約が難しい場合は来月でも問題ございません！
ただし、3か月が経過すると権利が消失してしまいますのでご注意ください！`;

  try {
    await navigator.clipboard.writeText(templateText);
    showNotification('テンプレートをコピーしました', 'success');
    console.log('[Template] Email template copied to clipboard');
  } catch (error) {
    console.error('[Template] Error copying to clipboard:', error);
    
    // Fallback: Create temporary textarea
    const textarea = document.createElement('textarea');
    textarea.value = templateText;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    
    try {
      document.execCommand('copy');
      showNotification('テンプレートをコピーしました', 'success');
      console.log('[Template] Email template copied using fallback method');
    } catch (fallbackError) {
      console.error('[Template] Fallback copy failed:', fallbackError);
      showNotification('コピーに失敗しました', 'error');
    }
    
    document.body.removeChild(textarea);
  }
}

/**
 * Apply filters and sort to roulette data
 */
function applyRouletteFilters() {
  if (!window.currentRouletteRawData || !window.currentRouletteTab) return;
  
  const tab = window.currentRouletteTab;
  let data = [...window.currentRouletteRawData];
  
  // Get filter values
  const statusFilter = document.getElementById('filter-status')?.value || '';
  const staffFilter = document.getElementById('filter-staff')?.value || '';
  const tutorFilter = document.getElementById('filter-tutor')?.value || '';
  const searchText = document.getElementById('search-student')?.value.toLowerCase().trim() || '';
  
  // Get sort values
  const sortField = document.getElementById('sort-field')?.value || 'drawnAt';
  const sortOrder = document.getElementById('sort-order')?.value || 'desc';
  
  // Apply filters
  data = data.filter(row => {
    // Status filter (winners only)
    if (tab === 'winners' && statusFilter) {
      if (row.status !== statusFilter) return false;
    }
    
    // Staff filter (winners only)
    if (tab === 'winners' && staffFilter) {
      if (staffFilter === '未割当') {
        if (row.consultationStaff) return false;
      } else {
        if (row.consultationStaff !== staffFilter) return false;
      }
    }
    
    // Tutor filter
    if (tutorFilter && row.homeroom_tutor !== tutorFilter) {
      return false;
    }
    
    // Search filter
    if (searchText) {
      const studentName = (row.studentName || '').toLowerCase();
      const studentId = (row.studentId || '').toLowerCase();
      if (!studentName.includes(searchText) && !studentId.includes(searchText)) {
        return false;
      }
    }
    
    return true;
  });
  
  // Apply sort
  data.sort((a, b) => {
    let aVal, bVal;
    
    switch (sortField) {
      case 'drawnAt':
        aVal = new Date(tab === 'unopened' ? a.notifiedAt : a.drawnAt);
        bVal = new Date(tab === 'unopened' ? b.notifiedAt : b.drawnAt);
        break;
      case 'studentName':
        aVal = a.studentName || '';
        bVal = b.studentName || '';
        break;
      case 'continuedMonths':
        aVal = a.continuedMonths || 0;
        bVal = b.continuedMonths || 0;
        break;
      case 'probability':
        aVal = a.probability || 0;
        bVal = b.probability || 0;
        break;
      case 'status':
        aVal = a.status || '';
        bVal = b.status || '';
        break;
      default:
        aVal = a[sortField];
        bVal = b[sortField];
    }
    
    if (sortOrder === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    } else {
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    }
  });
  
  // Update filtered count
  document.getElementById('roulette-filtered-count').textContent = data.length;
  
  // Re-render table
  window.currentRouletteData = data;
  renderRouletteTable(tab, data);
  
  console.log(`[Roulette] Filtered: ${data.length} / ${window.currentRouletteRawData.length} records`);
}

/**
 * Reset all filters
 */
function resetRouletteFilters() {
  // Reset filter inputs
  const statusFilter = document.getElementById('filter-status');
  const staffFilter = document.getElementById('filter-staff');
  const tutorFilter = document.getElementById('filter-tutor');
  const searchInput = document.getElementById('search-student');
  const sortField = document.getElementById('sort-field');
  const sortOrder = document.getElementById('sort-order');
  
  if (statusFilter) statusFilter.value = '';
  if (staffFilter) staffFilter.value = '';
  if (tutorFilter) tutorFilter.value = '';
  if (searchInput) searchInput.value = '';
  if (sortField) sortField.value = 'drawnAt';
  if (sortOrder) sortOrder.value = 'desc';
  
  // Re-apply (which will show all data)
  applyRouletteFilters();
  
  showNotification('フィルターをリセットしました', 'info');
}

// ========== Red List ==========

/**
 * Load red list data for all students
 */
async function loadRedListData() {
  try {
    console.log('[Red List] Loading red list data...');
    const response = await axios.get(`${API_BASE}/api/red-list`);
    
    if (response.data.success) {
      const redLists = response.data.data;
      console.log(`[Red List] Loaded ${redLists.length} red list records`);
      
      // If no data exists, trigger automatic calculation
      if (redLists.length === 0) {
        console.log('[Red List] No data found, triggering automatic update...');
        try {
          await axios.post(`${API_BASE}/api/red-list/update`, {});
          // Reload data after update
          const retryResponse = await axios.get(`${API_BASE}/api/red-list`);
          if (retryResponse.data.success) {
            const newRedLists = retryResponse.data.data;
            console.log(`[Red List] Loaded ${newRedLists.length} red list records after update`);
            newRedLists.forEach(redList => {
              updateRedListDisplay(redList.student_id, redList);
            });
          }
        } catch (updateError) {
          console.error('[Red List] Error during automatic update:', updateError);
          // Show all cells as empty if update fails
          document.querySelectorAll('.red-list-loading').forEach(cell => {
            cell.innerHTML = '<span class="text-gray-400 text-xs">-</span>';
          });
        }
        return;
      }
      
      // Update display for each student
      redLists.forEach(redList => {
        updateRedListDisplay(redList.student_id, redList);
      });
      
      // For students not in the list, show empty
      document.querySelectorAll('.red-list-loading').forEach(cell => {
        const studentId = cell.dataset.studentId;
        const hasData = redLists.find(r => r.student_id === studentId);
        if (!hasData) {
          cell.innerHTML = '<span class="text-gray-400 text-xs">-</span>';
        }
      });
    }
  } catch (error) {
    console.error('[Red List] Error loading red list data:', error);
    // Show all cells as empty on error
    document.querySelectorAll('.red-list-loading').forEach(cell => {
      cell.innerHTML = '<span class="text-gray-400 text-xs">-</span>';
    });
  }
}

/**
 * Update red list display for a student
 */
function updateRedListDisplay(studentId, redList) {
  const cell = document.querySelector(`.red-list-loading[data-student-id="${studentId}"]`);
  
  if (!cell) return;
  
  if (!redList || redList.total_score === 0) {
    cell.innerHTML = '<span class="text-gray-400 text-xs">-</span>';
    return;
  }
  
  // Determine color based on rank
  let bgColor = 'bg-gray-100';
  let textColor = 'text-gray-600';
  let rankText = '-';
  
  if (redList.rank === 'high') {
    bgColor = 'bg-red-100';
    textColor = 'text-red-700';
    rankText = 'HIGH';
  } else if (redList.rank === 'middle') {
    bgColor = 'bg-orange-100';
    textColor = 'text-orange-700';
    rankText = 'MID';
  } else if (redList.rank === 'low') {
    bgColor = 'bg-yellow-100';
    textColor = 'text-yellow-700';
    rankText = 'LOW';
  }
  
  // Build breakdown tooltip
  const breakdown = [
    { label: '満足度', score: redList.satisfaction_score, max: 4, icon: '😊' },
    { label: '欠席', score: redList.absence_score, max: 3, icon: '❌' },
    { label: 'アンケート', score: redList.survey_score, max: 1, icon: '📝' },
    { label: 'リスケ', score: redList.reschedule_score, max: 1, icon: '📅' },
    { label: '予約不足', score: redList.reservation_score, max: 1, icon: '📌' }
  ];
  
  const tooltipContent = breakdown
    .map(item => {
      const hasScore = item.score > 0;
      const scoreColor = hasScore ? 'text-red-600' : 'text-gray-400';
      return `<div class="flex justify-between items-center py-0.5">
        <span class="text-xs">${item.icon} ${item.label}</span>
        <span class="text-xs font-bold ${scoreColor}">${item.score}/${item.max}点</span>
      </div>`;
    })
    .join('');
  
  cell.innerHTML = `
    <div class="relative inline-flex flex-col items-center cursor-pointer red-list-item group">
      <span class="text-xs font-bold ${textColor}">${redList.total_score}点</span>
      <span class="text-xs px-1 rounded ${bgColor} ${textColor} font-semibold">${rankText}</span>
      
      <!-- Tooltip -->
      <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 hidden group-hover:block z-50 w-48">
        <div class="bg-gray-900 text-white rounded-lg shadow-lg p-3">
          <div class="text-xs font-bold mb-2 border-b border-gray-700 pb-1">
            📊 レッドリスト内訳
          </div>
          ${tooltipContent}
          <div class="border-t border-gray-700 mt-2 pt-2 flex justify-between items-center">
            <span class="text-xs font-bold">合計</span>
            <span class="text-xs font-bold text-yellow-400">${redList.total_score}/10点</span>
          </div>
        </div>
        <!-- Arrow -->
        <div class="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
      </div>
    </div>
  `;
}

/**
 * Update red list for all students (admin action)
 */
async function updateAllRedLists() {
  if (!confirm('全生徒のレッドリストを更新しますか？')) {
    return;
  }
  
  try {
    showNotification('レッドリスト更新中...', 'info');
    
    const response = await axios.post(`${API_BASE}/api/red-list/update`, {});
    
    if (response.data.success) {
      showNotification(`レッドリスト更新完了: ${response.data.data.updated}件`, 'success');
      await loadRedListData();
    }
  } catch (error) {
    console.error('[Red List] Error updating red lists:', error);
    showNotification('レッドリスト更新に失敗しました', 'error');
  }
}

// Red List Page
let currentRedListTab = 'current';
let currentRedListData = [];
let historyRedListData = [];
let redListMessages = [];       // 送信メッセージテンプレート
let redListDiscordLogs = {};    // { studentId_yearMonth: [log, ...] }
let redListSenders = [];        // 送信者マスタ

async function renderRedListPage() {
  const content = document.getElementById('content');
  
  content.innerHTML = `
    <!-- Header with Update Button -->
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">
        <i class="fas fa-exclamation-triangle text-red-600 mr-2"></i>
        レッドリスト
      </h2>
      <button onclick="updateRedListData()" 
              class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition duration-200 shadow-md">
        <i class="fas fa-sync-alt mr-2"></i>データ更新
      </button>
    </div>

    <!-- Tabs -->
    <div class="bg-white rounded-lg shadow-md mb-6">
      <div class="border-b border-gray-200">
        <nav class="flex -mb-px">
          <button onclick="switchRedListTab('current')" id="redlist-tab-current" 
                  class="py-4 px-6 text-sm font-medium border-b-2 border-blue-600 text-blue-600">
            <i class="fas fa-calendar-day"></i> 今月のレッドリスト
          </button>
          <button onclick="switchRedListTab('history')" id="redlist-tab-history"
                  class="py-4 px-6 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">
            <i class="fas fa-history"></i> 過去のレッドリスト
          </button>
          <button onclick="switchRedListTab('messages')" id="redlist-tab-messages"
                  class="py-4 px-6 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">
            <i class="fab fa-discord"></i> 送信メッセージ管理
          </button>
          <button onclick="switchRedListTab('senders')" id="redlist-tab-senders"
                  class="py-4 px-6 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">
            <i class="fas fa-user-tie"></i> 送信者管理
          </button>
        </nav>
      </div>
    </div>

    <!-- Stats Summary -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-lg shadow-md p-4">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <div class="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
              <i class="fas fa-fire text-red-600 text-xl"></i>
            </div>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-600">HIGH</p>
            <p class="text-2xl font-bold text-red-600" id="redlist-count-high">0</p>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-lg shadow-md p-4">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <div class="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
              <i class="fas fa-exclamation-circle text-orange-600 text-xl"></i>
            </div>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-600">MIDDLE</p>
            <p class="text-2xl font-bold text-orange-600" id="redlist-count-middle">0</p>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-lg shadow-md p-4">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <div class="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <i class="fas fa-exclamation-triangle text-yellow-600 text-xl"></i>
            </div>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-600">LOW</p>
            <p class="text-2xl font-bold text-yellow-600" id="redlist-count-low">0</p>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-lg shadow-md p-4">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <i class="fas fa-check-circle text-green-600 text-xl"></i>
            </div>
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-600">対応済み</p>
            <p class="text-2xl font-bold text-green-600" id="redlist-count-resolved">0</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Current Month List -->
    <div id="redlist-current-list" class="bg-white rounded-lg shadow-md">
      <div class="p-6">
        <div id="redlist-current-loading" class="text-center py-8">
          <i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i>
          <p class="text-gray-500 mt-2">読み込み中...</p>
        </div>
        <div id="redlist-current-content" class="hidden"></div>
      </div>
    </div>

    <!-- History List -->
    <div id="redlist-history-list" class="bg-white rounded-lg shadow-md hidden">
      <div class="p-6">
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">対象月</label>
          <select id="redlist-history-month" onchange="loadRedListHistoryData()" 
                  class="border border-gray-300 rounded-lg px-4 py-2 w-64">
            <option value="">月を選択...</option>
          </select>
        </div>
        <div id="redlist-history-loading" class="text-center py-8 hidden">
          <i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i>
          <p class="text-gray-500 mt-2">読み込み中...</p>
        </div>
        <div id="redlist-history-content"></div>
      </div>
    </div>

    <!-- Senders Management Panel -->
    <div id="redlist-senders-panel" class="hidden">
      <div class="bg-white rounded-lg shadow-md mb-4">
        <div class="p-6">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-800">
              <i class="fas fa-user-tie text-indigo-500 mr-2"></i>送信者管理
            </h3>
            <button onclick="openRedListSenderModal()"
                    class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm transition">
              <i class="fas fa-plus mr-1"></i>新規追加
            </button>
          </div>
          <div id="redlist-senders-loading" class="text-center py-8 hidden">
            <i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i>
            <p class="text-gray-500 mt-2">読み込み中...</p>
          </div>
          <div id="redlist-senders-content"></div>
        </div>
      </div>
    </div>

    <!-- Messages Management Panel -->
    <div id="redlist-messages-panel" class="hidden">
      <!-- Message Template List -->
      <div class="bg-white rounded-lg shadow-md mb-4">
        <div class="p-6">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-800">
              <i class="fab fa-discord text-indigo-500 mr-2"></i>送信メッセージテンプレート
            </h3>
            <button onclick="openRedListMessageModal()" 
                    class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm transition">
              <i class="fas fa-plus mr-1"></i>新規作成
            </button>
          </div>
          <div id="redlist-messages-loading" class="text-center py-8 hidden">
            <i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i>
            <p class="text-gray-500 mt-2">読み込み中...</p>
          </div>
          <div id="redlist-messages-content"></div>
        </div>
      </div>
    </div>

    <!-- Discord Send Modal -->
    <div id="redlist-discord-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden flex items-center justify-center">
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 max-h-screen overflow-y-auto">
        <div class="flex justify-between items-center p-6 border-b">
          <h3 class="text-lg font-semibold text-gray-800">
            <i class="fab fa-discord text-indigo-500 mr-2"></i>Discord 送信
          </h3>
          <button onclick="closeRedListDiscordModal()" class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <p class="text-sm text-gray-600">
            送信先: <span id="redlist-discord-modal-student" class="font-semibold text-gray-900"></span>
          </p>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">テンプレートを選択</label>
            <select id="redlist-discord-modal-select"
                    onchange="onRedListMessageSelectChange()"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500">
              <option value="">テンプレートを選択...</option>
            </select>
          </div>
          <!-- テンプレート添付画像プレビュー -->
          <div id="redlist-discord-modal-img-wrap" class="hidden">
            <p class="text-xs font-medium text-gray-600 mb-1"><i class="fas fa-image mr-1 text-indigo-400"></i>添付画像</p>
            <img id="redlist-discord-modal-img" src="" alt="添付画像"
                 class="max-h-40 rounded-lg border border-gray-200 object-contain">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">送信メッセージ</label>
            <textarea id="redlist-discord-modal-content"
                      rows="6"
                      placeholder="送信するメッセージを入力してください..."
                      class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 resize-y"></textarea>
            <!-- Markdown ヒント -->
            <div class="mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-500 space-y-0.5">
              <p class="font-medium text-gray-600 mb-1">Discord Markdown 記法</p>
              <p><code class="bg-gray-200 px-1 rounded"># 見出し1</code>　<code class="bg-gray-200 px-1 rounded">## 見出し2</code>　<code class="bg-gray-200 px-1 rounded">### 見出し3</code></p>
              <p><code class="bg-gray-200 px-1 rounded">**太字**</code>　<code class="bg-gray-200 px-1 rounded">*斜体*</code>　<code class="bg-gray-200 px-1 rounded">__下線__</code>　<code class="bg-gray-200 px-1 rounded">~~打消し~~</code></p>
              <p><code class="bg-gray-200 px-1 rounded">> 引用</code>　<code class="bg-gray-200 px-1 rounded">- リスト</code>　<code class="bg-gray-200 px-1 rounded">\`コード\`</code></p>
              <p class="text-indigo-500"><i class="fas fa-user-tag mr-1"></i><code class="bg-indigo-50 px-1 rounded">〇〇</code> と書くと生徒様の名前に自動置換されます</p>
            </div>
          </div>
          <!-- 送信者選択 -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              <i class="fas fa-user-tie mr-1 text-indigo-400"></i>送信者を選択（任意）
            </label>
            <select id="redlist-discord-sender-select"
                    onchange="onRedListSenderSelectChange()"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500">
              <option value="">送信者を選択しない</option>
            </select>
            <!-- 予約URLプレビュー -->
            <div id="redlist-discord-booking-url-wrap" class="hidden mt-2 p-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-700">
              <i class="fas fa-calendar-check mr-1"></i>予約URL:
              <span id="redlist-discord-booking-url-preview" class="break-all font-mono"></span>
              <p class="text-gray-500 mt-1">※ メッセージ末尾に自動的に追加されます</p>
            </div>
          </div>
          <p class="text-xs text-gray-400">※ 生徒様の Discord ID が設定されている場合はメンションが自動付与されます</p>
        </div>
        <div class="flex justify-end space-x-3 p-6 border-t bg-gray-50 rounded-b-xl">
          <button onclick="closeRedListDiscordModal()" 
                  class="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            キャンセル
          </button>
          <button onclick="sendRedListDiscordMessage()" id="redlist-discord-send-btn"
                  class="px-6 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition">
            <i class="fab fa-discord mr-1"></i>送信
          </button>
        </div>
      </div>
    </div>

    <!-- Message Template Edit Modal -->
    <div id="redlist-msg-edit-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden flex items-center justify-center">
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 max-h-screen overflow-y-auto">
        <div class="flex justify-between items-center p-6 border-b">
          <h3 class="text-lg font-semibold text-gray-800" id="redlist-msg-edit-title">メッセージ作成</h3>
          <button onclick="closeRedListMessageModal()" class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <input type="hidden" id="redlist-msg-edit-id" value="">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">タイトル（管理用）</label>
            <input id="redlist-msg-edit-name" type="text" placeholder="例: 欠席が多い生徒向け" 
                   class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">メッセージ本文</label>
            <textarea id="redlist-msg-edit-content" rows="8"
                      placeholder="送信するメッセージ本文を入力...\n\n〇〇様 と書くと送信時に生徒様の名前に置換されます"
                      class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 resize-y"></textarea>
            <!-- Markdown ヒント -->
            <div class="mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-500 space-y-0.5">
              <p class="font-medium text-gray-600 mb-1">Discord Markdown 記法</p>
              <p><code class="bg-gray-200 px-1 rounded"># 見出し1</code>　<code class="bg-gray-200 px-1 rounded">## 見出し2</code>　<code class="bg-gray-200 px-1 rounded">### 見出し3</code></p>
              <p><code class="bg-gray-200 px-1 rounded">**太字**</code>　<code class="bg-gray-200 px-1 rounded">*斜体*</code>　<code class="bg-gray-200 px-1 rounded">__下線__</code>　<code class="bg-gray-200 px-1 rounded">~~打消し~~</code></p>
              <p><code class="bg-gray-200 px-1 rounded">> 引用</code>　<code class="bg-gray-200 px-1 rounded">- リスト</code>　<code class="bg-gray-200 px-1 rounded">\`コード\`</code></p>
              <p class="text-indigo-500"><i class="fas fa-user-tag mr-1"></i><code class="bg-indigo-50 px-1 rounded">〇〇</code> と書くと送信時に生徒様の名前に自動置換されます</p>
            </div>
          </div>
          <!-- 画像添付 -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              <i class="fas fa-image mr-1 text-indigo-400"></i>添付画像（JPEG / PNG）
            </label>
            <!-- 既存画像プレビュー -->
            <div id="redlist-msg-edit-img-current" class="hidden mb-2">
              <p class="text-xs text-gray-500 mb-1">現在の画像:</p>
              <div class="flex items-center space-x-3">
                <img id="redlist-msg-edit-img-preview" src="" alt="現在の画像"
                     class="max-h-32 rounded-lg border border-gray-200 object-contain">
                <button type="button" onclick="removeRedListMessageImage()"
                        class="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1 hover:bg-red-50">
                  <i class="fas fa-trash mr-1"></i>削除
                </button>
              </div>
            </div>
            <!-- 新規画像選択 -->
            <input type="file" id="redlist-msg-edit-image" accept="image/jpeg,image/png"
                   onchange="onRedListImageSelected(this)"
                   class="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100">
            <!-- 新規画像プレビュー -->
            <div id="redlist-msg-edit-img-new-wrap" class="hidden mt-2">
              <img id="redlist-msg-edit-img-new" src="" alt="新しい画像"
                   class="max-h-32 rounded-lg border border-gray-200 object-contain">
            </div>
            <p class="text-xs text-gray-400 mt-1">最大サイズ: 8MB。Discord に画像として添付されます。</p>
            <input type="hidden" id="redlist-msg-edit-remove-image" value="false">
          </div>
        </div>
        <div class="flex justify-end space-x-3 p-6 border-t bg-gray-50 rounded-b-xl">
          <button onclick="closeRedListMessageModal()"
                  class="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            キャンセル
          </button>
          <button onclick="saveRedListMessage()"
                  class="px-6 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition">
            <i class="fas fa-save mr-1"></i>保存
          </button>
        </div>
      </div>
    </div>

    <!-- Test Send Modal -->
    <div id="redlist-test-send-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden flex items-center justify-center">
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div class="flex justify-between items-center p-6 border-b">
          <h3 class="text-lg font-semibold text-gray-800">
            <i class="fas fa-flask text-green-500 mr-2"></i>テスト送信
          </h3>
          <button onclick="closeRedListTestSendModal()" class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
            <p class="font-semibold mb-1"><i class="fas fa-info-circle mr-1"></i>テスト送信について</p>
            <p>以下の固定チャンネルへメッセージを送信します。<code class="bg-green-100 px-1 rounded">〇〇</code> は「テスト生徒」に置換されます。</p>
          </div>
          <div class="bg-gray-50 rounded-lg border border-gray-200 p-3 text-xs space-y-1">
            <p class="text-gray-500"><span class="font-medium text-gray-700">送信先チャンネル:</span></p>
            <p class="text-gray-600 break-all font-mono">https://discord.com/channels/1176426605309083678/1293539258069417994</p>
            <p class="text-gray-500 mt-1"><span class="font-medium text-gray-700">メンション先 ユーザーID:</span> <span class="font-mono">766666980086120470</span></p>
          </div>
          <div>
            <p class="text-sm text-gray-700">テンプレート: <span id="redlist-test-send-title" class="font-semibold text-gray-900"></span></p>
          </div>
          <!-- 送信者選択 -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              <i class="fas fa-user-tie mr-1 text-indigo-400"></i>送信者を選択（任意）
            </label>
            <select id="redlist-test-send-sender-select"
                    onchange="onRedListTestSendSenderChange()"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500">
              <option value="">送信者を選択しない</option>
            </select>
            <div id="redlist-test-send-booking-url-wrap" class="hidden mt-2 p-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-700">
              <i class="fas fa-calendar-check mr-1"></i>予約URL:
              <span id="redlist-test-send-booking-url-preview" class="break-all font-mono"></span>
              <p class="text-gray-500 mt-1">※ メッセージ末尾に自動的に追加されます</p>
            </div>
          </div>
          <input type="hidden" id="redlist-test-send-message-id" value="">
        </div>
        <div class="flex justify-end space-x-3 p-6 border-t bg-gray-50 rounded-b-xl">
          <button onclick="closeRedListTestSendModal()"
                  class="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            キャンセル
          </button>
          <button onclick="executeRedListTestSend()" id="redlist-test-send-btn"
                  class="px-6 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition">
            <i class="fas fa-paper-plane mr-1"></i>テスト送信
          </button>
        </div>
      </div>
    </div>

    <!-- Sender Edit Modal -->
    <div id="redlist-sender-edit-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden flex items-center justify-center">
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div class="flex justify-between items-center p-6 border-b">
          <h3 class="text-lg font-semibold text-gray-800" id="redlist-sender-edit-title">送信者追加</h3>
          <button onclick="closeRedListSenderModal()" class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <input type="hidden" id="redlist-sender-edit-id" value="">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">送信者名</label>
            <input id="redlist-sender-edit-name" type="text" placeholder="例: 山田 太郎"
                   class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">予約URL</label>
            <input id="redlist-sender-edit-url" type="url" placeholder="https://..."
                   class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500">
            <p class="text-xs text-gray-400 mt-1">Discord送信時にメッセージ末尾へ自動追加されます</p>
          </div>
        </div>
        <div class="flex justify-end space-x-3 p-6 border-t bg-gray-50 rounded-b-xl">
          <button onclick="closeRedListSenderModal()"
                  class="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            キャンセル
          </button>
          <button onclick="saveRedListSender()"
                  class="px-6 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition">
            <i class="fas fa-save mr-1"></i>保存
          </button>
        </div>
      </div>
    </div>
  `;
  
  // Populate history months
  populateRedListHistoryMonths();
  
  // Load current data
  await loadRedListCurrentData();
}

function switchRedListTab(tab) {
  currentRedListTab = tab;

  const tabDefs = [
    { id: 'current',  elId: 'redlist-tab-current' },
    { id: 'history',  elId: 'redlist-tab-history' },
    { id: 'messages', elId: 'redlist-tab-messages' },
    { id: 'senders',  elId: 'redlist-tab-senders'  }
  ];
  const activeClass   = 'py-4 px-6 text-sm font-medium border-b-2 border-blue-600 text-blue-600';
  const inactiveClass = 'py-4 px-6 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';

  tabDefs.forEach(t => {
    const el = document.getElementById(t.elId);
    if (el) el.className = tab === t.id ? activeClass : inactiveClass;
  });

  // Show/hide panels
  document.getElementById('redlist-current-list').classList.toggle('hidden',   tab !== 'current');
  document.getElementById('redlist-history-list').classList.toggle('hidden',   tab !== 'history');
  document.getElementById('redlist-messages-panel').classList.toggle('hidden', tab !== 'messages');
  document.getElementById('redlist-senders-panel').classList.toggle('hidden',  tab !== 'senders');

  // 集計パートは current / history のみ更新
  if (tab !== 'messages' && tab !== 'senders') updateRedListStats();

  // 各管理タブを初めて開いたときにデータ取得
  if (tab === 'messages' && redListMessages.length === 0) {
    loadRedListMessages();
  }
  if (tab === 'senders' && redListSenders.length === 0) {
    loadRedListSenders();
  }
}

async function loadRedListCurrentData() {
  try {
    document.getElementById('redlist-current-loading').classList.remove('hidden');
    document.getElementById('redlist-current-content').classList.add('hidden');

    const ym = getCurrentYearMonthStr();
    const [response] = await Promise.all([
      axios.get(`${API_BASE}/api/red-list`),
      fetchRedListDiscordLogs(ym)
    ]);

    if (response.data.success) {
      currentRedListData = response.data.data.filter(item =>
        item.rank === 'high' || item.rank === 'middle' || item.rank === 'low'
      );
      renderRedListCurrentList();
      updateRedListStats();
    }
  } catch (error) {
    console.error('Error loading red list data:', error);
    document.getElementById('redlist-current-content').innerHTML =
      '<div class="text-center py-8 text-red-600">データの読み込みに失敗しました</div>';
  } finally {
    document.getElementById('redlist-current-loading').classList.add('hidden');
    document.getElementById('redlist-current-content').classList.remove('hidden');
  }
}

async function updateRedListData() {
  try {
    const button = event.target.closest('button');
    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>更新中...';
    
    const response = await axios.post(`${API_BASE}/api/red-list/update`, {}, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    if (response.data.success) {
      // Reload current data
      await loadRedListCurrentData();
      
      // Show success notification
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50';
      notification.innerHTML = '<i class="fas fa-check-circle mr-2"></i>レッドリストを更新しました';
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.remove();
      }, 3000);
    }
  } catch (error) {
    console.error('Error updating red list:', error);
    alert('レッドリストの更新に失敗しました');
  } finally {
    const button = event.target.closest('button');
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>データ更新';
  }
}

function renderRedListCurrentList() {
  const container = document.getElementById('redlist-current-content');
  
  if (currentRedListData.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-check-circle text-6xl text-green-400 mb-4"></i>
        <p class="text-xl font-medium text-gray-600">該当する生徒はいません</p>
        <p class="text-sm text-gray-500 mt-2">ランクがLOW以上の生徒がいません</p>
      </div>
    `;
    return;
  }
  
  // Sort by total_score desc
  currentRedListData.sort((a, b) => b.total_score - a.total_score);
  
  container.innerHTML = currentRedListData.map(item => renderRedListStudentCard(item, false)).join('');
}

function renderRedListStudentCard(item, isHistory) {
  const student = students.find(s => s.student_id === item.student_id);
  const studentName = student ? student.name : item.student_name || '不明';
  const tutorName = student ? getTutorDisplayName(student.homeroom_tutor) : '-';
  
  const notionUrl = cachedNotionUrls[item.student_id] || student?.notion_url || '#';
  const discordUrl = student?.discord_url || '#';
  const youtubeId = student?.youtube_channel_id || '';
  const xId = student?.x_account_id || '';
  
  let rankColor = 'bg-gray-100 text-gray-700';
  let rankText = '-';
  
  if (item.rank === 'high' || item.final_rank === 'high') {
    rankColor = 'bg-red-100 text-red-700';
    rankText = 'HIGH';
  } else if (item.rank === 'middle' || item.final_rank === 'middle') {
    rankColor = 'bg-orange-100 text-orange-700';
    rankText = 'MID';
  } else if (item.rank === 'low' || item.final_rank === 'low') {
    rankColor = 'bg-yellow-100 text-yellow-700';
    rankText = 'LOW';
  }
  
  const score = item.total_score || item.final_score || 0;
  const yearMonth = item.year_month;
  const consecutiveMonths = 1; // TODO: Calculate from history
  
  // Get satisfaction average from red list data (preferred) or surveyStatsCache (fallback)
  let satisfactionDisplay = '<span class="text-gray-400">-</span>';
  const satisfactionAvg = item.satisfaction_avg || item.final_satisfaction_avg;
  
  if (satisfactionAvg !== null && satisfactionAvg !== undefined) {
    const avg = parseFloat(satisfactionAvg);
    const color = avg >= 8 ? 'text-green-600' : avg >= 6 ? 'text-yellow-600' : 'text-red-600';
    satisfactionDisplay = `<span class="${color} font-semibold">${avg.toFixed(1)}</span>`;
  } else {
    // Fallback to surveyStatsCache
    const surveyStats = surveyStatsCache[item.student_id];
    if (surveyStats && surveyStats.latestSatisfaction) {
      const sat = surveyStats.latestSatisfaction;
      const average = sat.average || 0;
      const color = average >= 8 ? 'text-green-600' : average >= 6 ? 'text-yellow-600' : 'text-red-600';
      satisfactionDisplay = `<span class="${color} font-semibold">${average.toFixed(1)}</span>`;
    }
  }
  
  // Build score breakdown
  const satisfactionScore = item.satisfaction_score || 0;
  const absenceScore = item.absence_score || 0;
  const surveyScore = item.survey_score || 0;
  const rescheduleScore = item.reschedule_score || 0;
  const reservationScore = item.reservation_score || 0;
  
  const scoreBreakdown = `
    <div class="mt-2 text-xs">
      <button onclick="showScoreBreakdown('${item.student_id}')" 
              class="text-blue-600 hover:text-blue-800" 
              title="スコア内訳を表示">
        <i class="fas fa-list-ul"></i> スコア内訳
      </button>
      <div id="score-breakdown-${item.student_id}" class="hidden mt-2 bg-gray-50 p-3 rounded border border-gray-200">
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-600">満足度 (0-4):</span>
            <span class="font-semibold ${satisfactionScore > 0 ? 'text-red-600' : 'text-green-600'}">${satisfactionScore}点</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">欠席 (0-3):</span>
            <span class="font-semibold ${absenceScore > 0 ? 'text-red-600' : 'text-green-600'}">${absenceScore}点</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">アンケート (0-1):</span>
            <span class="font-semibold ${surveyScore > 0 ? 'text-red-600' : 'text-green-600'}">${surveyScore}点</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">リスケ (0-1):</span>
            <span class="font-semibold ${rescheduleScore > 0 ? 'text-red-600' : 'text-green-600'}">${rescheduleScore}点</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">予約 (0-1):</span>
            <span class="font-semibold ${reservationScore > 0 ? 'text-red-600' : 'text-green-600'}">${reservationScore}点</span>
          </div>
          <div class="flex justify-between border-t border-gray-300 pt-2">
            <span class="text-gray-800 font-bold">合計:</span>
            <span class="font-bold text-gray-900">${score}点</span>
          </div>
        </div>
      </div>
    </div>
  `;
  
  const cs = item.correspondence_status || '未対応';
  const ao = item.assigned_to || '';
  const statusColor =
    cs === '対応済み' ? 'bg-green-100 text-green-700 border-green-300' :
    cs === '対応中'   ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                        'bg-red-50 text-red-600 border-red-200';

  return `
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm mb-3 hover:shadow-md transition-shadow">
      <!-- カード上部：ランク＋生徒情報＋操作 -->
      <div class="flex items-start gap-3 p-4">

        <!-- ① ランクバッジ（縦中央） -->
        <div class="flex-shrink-0 flex flex-col items-center pt-0.5">
          <span class="inline-flex items-center justify-center w-14 py-1.5 rounded-lg ${rankColor} font-bold text-sm leading-tight text-center">
            ${rankText}
          </span>
          <span class="text-xs font-bold text-gray-500 mt-1">${score}点</span>
        </div>

        <!-- ② 生徒情報（中央・flex-1で広がる） -->
        <div class="flex-1 min-w-0">
          <!-- 氏名行 -->
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span class="text-xs font-mono text-gray-400">${item.student_id}</span>
            <span class="text-base font-bold text-gray-900">${studentName}</span>
            <span class="text-xs text-gray-500"><i class="fas fa-user-tie mr-0.5"></i>${tutorName}</span>
          </div>
          <!-- SNS・日付行 -->
          <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
            ${notionUrl !== '#'
              ? `<a href="${notionUrl}" target="_blank" class="text-gray-400 hover:text-blue-600 text-sm"><i class="fas fa-file-alt"></i></a>`
              : '<i class="fas fa-file-alt text-gray-200 text-sm"></i>'}
            ${discordUrl !== '#'
              ? `<a href="${discordUrl}" target="_blank" class="text-gray-400 hover:text-purple-600 text-sm"><i class="fab fa-discord"></i></a>`
              : '<i class="fab fa-discord text-gray-200 text-sm"></i>'}
            ${youtubeId
              ? `<a href="${formatYouTubeUrl(youtubeId)}" target="_blank" class="text-gray-400 hover:text-red-600 text-sm"><i class="fab fa-youtube"></i></a>`
              : '<i class="fab fa-youtube text-gray-200 text-sm"></i>'}
            ${xId
              ? `<a href="${formatXUrl(xId)}" target="_blank" class="text-gray-400 hover:text-blue-400 text-sm"><i class="fab fa-x-twitter"></i></a>`
              : '<i class="fab fa-x-twitter text-gray-200 text-sm"></i>'}
            <span class="text-xs text-gray-400"><i class="fas fa-calendar-alt mr-0.5"></i>${yearMonth}</span>
            <span class="text-xs text-gray-400"><i class="fas fa-redo-alt mr-0.5"></i>連続 ${consecutiveMonths}ヶ月</span>
          </div>
          <!-- 満足度 -->
          <div class="mt-1.5 text-xs text-gray-500">
            今月の満足度: ${satisfactionDisplay}
          </div>
        </div>

        <!-- ③ 操作エリア（右端・固定幅） -->
        <div class="flex-shrink-0 flex flex-col items-end gap-2 min-w-[9rem]">
          ${!isHistory ? `
          <!-- 対応状況 -->
          <select onchange="updateRedListStatus('${item.student_id}', '${yearMonth}', this.value)"
                  id="rl-status-${item.student_id}"
                  class="w-full border ${statusColor} rounded-lg px-2 py-1.5 text-xs font-semibold focus:ring-2 focus:ring-blue-400 cursor-pointer">
            <option value="未対応"  ${cs === '未対応'  ? 'selected' : ''}>未対応</option>
            <option value="対応中"  ${cs === '対応中'  ? 'selected' : ''}>対応中</option>
            <option value="対応済み" ${cs === '対応済み' ? 'selected' : ''}>対応済み</option>
          </select>
          <!-- 担当者 -->
          <div class="flex items-center w-full border border-gray-200 rounded-lg px-2 py-1 bg-gray-50 gap-1">
            <i class="fas fa-user-tie text-indigo-300 text-xs flex-shrink-0"></i>
            <input id="rl-assigned-${item.student_id}" type="text"
                   value="${escapeHtml(ao)}"
                   placeholder="担当者名"
                   onchange="updateRedListAssigned('${item.student_id}', '${yearMonth}', this.value)"
                   class="bg-transparent text-xs text-gray-700 placeholder-gray-300 w-full focus:outline-none min-w-0">
          </div>
          ` : `
          <!-- 履歴タブ：対応状況バッジのみ表示 -->
          <span class="inline-block border ${statusColor} rounded-lg px-2 py-1 text-xs font-semibold">${cs}</span>
          ${ao ? `<span class="text-xs text-gray-400"><i class="fas fa-user-tie mr-0.5 text-indigo-300"></i>${escapeHtml(ao)}</span>` : ''}
          `}
          <!-- Discord送信ボタン -->
          <button onclick="openRedListDiscordModal('${item.student_id}', '${studentName}', '${yearMonth}')"
                  class="w-full flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm">
            <i class="fab fa-discord"></i>Discord送信
          </button>
        </div>

      </div>

      <!-- カード下部：スコア内訳＋Discord送信ログ（折りたたみ） -->
      <div class="border-t border-gray-100 px-4 pb-2 pt-1">
        ${scoreBreakdown}
        ${renderRedListDiscordLogs(item.student_id, yearMonth)}
      </div>
    </div>
  `;
}

function updateRedListStats() {
  // 過去タブが選択中なら historyRedListData を、現在タブなら currentRedListData を使う
  const isHistory = currentRedListTab === 'history';
  const data = isHistory ? historyRedListData : currentRedListData;
  const rankField = isHistory ? 'final_rank' : 'rank';

  const high   = data.filter(item => item[rankField] === 'high').length;
  const middle = data.filter(item => item[rankField] === 'middle').length;
  const low    = data.filter(item => item[rankField] === 'low').length;
  const resolved = 0; // TODO: Count resolved status
  
  document.getElementById('redlist-count-high').textContent = high;
  document.getElementById('redlist-count-middle').textContent = middle;
  document.getElementById('redlist-count-low').textContent = low;
  document.getElementById('redlist-count-resolved').textContent = resolved;
}

function showScoreBreakdown(studentId) {
  const breakdownElement = document.getElementById(`score-breakdown-${studentId}`);
  if (breakdownElement) {
    breakdownElement.classList.toggle('hidden');
  }
}

async function updateRedListStatus(studentId, yearMonth, status) {
  try {
    const res = await axios.patch(`${API_BASE}/api/red-list/${studentId}/status`, {
      yearMonth,
      correspondence_status: status
    }, { headers: { 'Authorization': `Bearer ${sessionToken}` } });

    if (res.data.success) {
      // ローカルデータを更新（再描画なし）
      const entry = currentRedListData.find(d => d.student_id === studentId);
      if (entry) entry.correspondence_status = status;
      updateRedListStats();
      showNotification(
        status === '対応済み' ? '対応済みに変更しました' :
        status === '対応中'  ? '対応中に変更しました'  : '未対応に変更しました',
        'success'
      );
    } else {
      showNotification(res.data.error || 'ステータスの更新に失敗しました', 'error');
    }
  } catch (error) {
    console.error('Error updating status:', error);
    showNotification('ステータスの更新に失敗しました', 'error');
  }
}

async function updateRedListAssigned(studentId, yearMonth, assignedTo) {
  try {
    const res = await axios.patch(`${API_BASE}/api/red-list/${studentId}/status`, {
      yearMonth,
      assigned_to: assignedTo
    }, { headers: { 'Authorization': `Bearer ${sessionToken}` } });

    if (res.data.success) {
      const entry = currentRedListData.find(d => d.student_id === studentId);
      if (entry) entry.assigned_to = assignedTo;
      showNotification('担当者を更新しました', 'success');
    } else {
      showNotification(res.data.error || '担当者の更新に失敗しました', 'error');
    }
  } catch (error) {
    console.error('Error updating assigned_to:', error);
    showNotification('担当者の更新に失敗しました', 'error');
  }
}

function populateRedListHistoryMonths() {
  const select = document.getElementById('redlist-history-month');
  const today = new Date();
  
  for (let i = 1; i <= 12; i++) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const displayText = `${date.getFullYear()}年${date.getMonth() + 1}月`;
    
    const option = document.createElement('option');
    option.value = yearMonth;
    option.textContent = displayText;
    select.appendChild(option);
  }
}

async function loadRedListHistoryData() {
  const yearMonth = document.getElementById('redlist-history-month').value;
  
  if (!yearMonth) {
    document.getElementById('redlist-history-content').innerHTML = '';
    return;
  }
  
  try {
    document.getElementById('redlist-history-loading').classList.remove('hidden');
    document.getElementById('redlist-history-content').innerHTML = '';
    
    const [response] = await Promise.all([
      axios.get(`${API_BASE}/api/red-list/history?yearMonth=${yearMonth}`),
      fetchRedListDiscordLogs(yearMonth)
    ]);

    if (response.data.success) {
      historyRedListData = response.data.data.filter(item =>
        item.final_rank === 'high' || item.final_rank === 'middle' || item.final_rank === 'low'
      );

      renderRedListHistoryList();
      updateRedListStats();
    }
  } catch (error) {
    console.error('Error loading history data:', error);
    document.getElementById('redlist-history-content').innerHTML = 
      '<div class="text-center py-8 text-red-600">データの読み込みに失敗しました</div>';
  } finally {
    document.getElementById('redlist-history-loading').classList.add('hidden');
  }
}

function renderRedListHistoryList() {
  const container = document.getElementById('redlist-history-content');
  
  if (historyRedListData.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-check-circle text-6xl text-green-400 mb-4"></i>
        <p class="text-xl font-medium text-gray-600">該当する生徒はいません</p>
        <p class="text-sm text-gray-500 mt-2">この月のレッドリストデータがありません</p>
      </div>
    `;
    return;
  }
  
  historyRedListData.sort((a, b) => b.final_score - a.final_score);
  
  container.innerHTML = historyRedListData.map(item => renderRedListStudentCard(item, true)).join('');
}


// ═══════════════════════════════════════════════════════════════
//  レッドリスト Discord 送信ログ表示
// ═══════════════════════════════════════════════════════════════

/** カード内の送信履歴ミニ表示 */
function renderRedListDiscordLogs(studentId, yearMonth) {
  const key = `${studentId}_${yearMonth}`;
  const logs = redListDiscordLogs[key];
  if (!logs || logs.length === 0) return '';

  const latest = logs[0]; // 最新1件
  const sentAt = new Date(latest.sent_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo',
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const allRows = logs.map(l => {
    const t = new Date(l.sent_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit' });
    return `<div class="border-b border-indigo-100 py-1 last:border-0">
      <div class="text-xs text-gray-500">${t} ／ ${l.sent_by || '-'}</div>
      <div class="text-xs font-medium text-indigo-700 truncate">${escapeHtml(l.message_title || l.message_content.slice(0,30)+'…')}</div>
    </div>`;
  }).join('');

  return `
    <div class="mt-2">
      <button onclick="toggleRedListLogDetail('${studentId}','${yearMonth}')"
              class="text-xs text-indigo-600 hover:text-indigo-800 flex items-center space-x-1">
        <i class="fab fa-discord"></i>
        <span>送信済み ${logs.length}件（最終: ${sentAt}）</span>
        <i class="fas fa-chevron-down text-xs" id="rl-log-chevron-${studentId}"></i>
      </button>
      <div id="rl-log-detail-${studentId}" class="hidden mt-1 bg-indigo-50 border border-indigo-200 rounded-lg p-2 max-h-40 overflow-y-auto">
        ${allRows}
      </div>
    </div>`;
}

function toggleRedListLogDetail(studentId, yearMonth) {
  const el = document.getElementById(`rl-log-detail-${studentId}`);
  const chevron = document.getElementById(`rl-log-chevron-${studentId}`);
  if (!el) return;
  const isHidden = el.classList.toggle('hidden');
  if (chevron) chevron.className = isHidden
    ? 'fas fa-chevron-down text-xs'
    : 'fas fa-chevron-up text-xs';
}


// ═══════════════════════════════════════════════════════════════
//  Discord 送信ログ一括取得（ページ表示時・送信後に呼ぶ）
// ═══════════════════════════════════════════════════════════════

async function fetchRedListDiscordLogs(yearMonth) {
  try {
    const ym = yearMonth || getCurrentYearMonthStr();
    const res = await axios.get(`${API_BASE}/api/red-list/discord/logs?yearMonth=${ym}`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    if (res.data.success) {
      redListDiscordLogs = {};
      for (const log of res.data.data) {
        const key = `${log.student_id}_${log.year_month}`;
        if (!redListDiscordLogs[key]) redListDiscordLogs[key] = [];
        redListDiscordLogs[key].push(log);
      }
    }
  } catch (e) {
    console.warn('Discord logs fetch failed:', e.message);
  }
}

function getCurrentYearMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════════
//  Discord 送信モーダル
// ═══════════════════════════════════════════════════════════════

let _rlDiscordTarget = { studentId: null, studentName: null, yearMonth: null };

async function openRedListDiscordModal(studentId, studentName, yearMonth) {
  _rlDiscordTarget = { studentId, studentName, yearMonth };

  // 生徒名表示
  document.getElementById('redlist-discord-modal-student').textContent =
    `${studentId} ${studentName}`;

  // テンプレート選択肢を最新状態に更新
  if (redListMessages.length === 0) {
    await loadRedListMessages(true); // silent
  }
  populateRedListDiscordSelect();

  // 送信者選択肢を最新状態に更新
  if (redListSenders.length === 0) {
    await loadRedListSenders(true); // silent
  }
  populateRedListSenderSelect();

  // テキストエリア・画像・送信者をリセット
  document.getElementById('redlist-discord-modal-content').value = '';
  document.getElementById('redlist-discord-modal-img-wrap').classList.add('hidden');
  document.getElementById('redlist-discord-sender-select').value = '';
  document.getElementById('redlist-discord-booking-url-wrap').classList.add('hidden');

  // モーダル表示
  document.getElementById('redlist-discord-modal').classList.remove('hidden');
}

function closeRedListDiscordModal() {
  document.getElementById('redlist-discord-modal').classList.add('hidden');
  _rlDiscordTarget = { studentId: null, studentName: null, yearMonth: null };
}

/** 送信者ドロップダウンを描画 */
function populateRedListSenderSelect() {
  const sel = document.getElementById('redlist-discord-sender-select');
  sel.innerHTML = '<option value="">送信者を選択しない</option>';
  redListSenders.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    opt.dataset.bookingUrl = s.booking_url;
    sel.appendChild(opt);
  });
}

/** 送信者選択変更 → 予約URLプレビュー */
function onRedListSenderSelectChange() {
  const sel     = document.getElementById('redlist-discord-sender-select');
  const opt     = sel.options[sel.selectedIndex];
  const urlWrap = document.getElementById('redlist-discord-booking-url-wrap');
  const urlSpan = document.getElementById('redlist-discord-booking-url-preview');
  if (opt && opt.dataset.bookingUrl) {
    urlSpan.textContent = opt.dataset.bookingUrl;
    urlWrap.classList.remove('hidden');
  } else {
    urlWrap.classList.add('hidden');
    urlSpan.textContent = '';
  }
}

function populateRedListDiscordSelect() {
  const sel = document.getElementById('redlist-discord-modal-select');
  sel.innerHTML = '<option value="">テンプレートを選択...</option>';
  redListMessages.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.title;
    opt.dataset.content = m.content;
    opt.dataset.hasImage = m.has_image ? '1' : '';
    sel.appendChild(opt);
  });
}

function onRedListMessageSelectChange() {
  const sel       = document.getElementById('redlist-discord-modal-select');
  const opt       = sel.options[sel.selectedIndex];
  const textarea  = document.getElementById('redlist-discord-modal-content');
  const imgWrap   = document.getElementById('redlist-discord-modal-img-wrap');
  const imgEl     = document.getElementById('redlist-discord-modal-img');
  const { studentName } = _rlDiscordTarget;

  if (opt && opt.dataset.content) {
    // 〇〇 → 生徒名をプレビュー表示（実際の置換はサーバー側で行う）
    let preview = opt.dataset.content;
    if (studentName) {
      preview = preview.replace(/〇〇/g, studentName).replace(/○○/g, studentName);
    }
    textarea.value = preview;

    // 添付画像プレビュー
    if (opt.dataset.hasImage === '1') {
      const msgId = opt.value;
      imgEl.src = `${API_BASE}/api/red-list/messages/${msgId}/image`;
      imgWrap.classList.remove('hidden');
    } else {
      imgWrap.classList.add('hidden');
      imgEl.src = '';
    }
  } else if (!sel.value) {
    textarea.value = '';
    imgWrap.classList.add('hidden');
    imgEl.src = '';
  }
}

async function sendRedListDiscordMessage() {
  const { studentId, studentName, yearMonth } = _rlDiscordTarget;
  const sel        = document.getElementById('redlist-discord-modal-select');
  const senderSel  = document.getElementById('redlist-discord-sender-select');
  const content    = document.getElementById('redlist-discord-modal-content').value.trim();
  const btn        = document.getElementById('redlist-discord-send-btn');

  if (!content) {
    showNotification('メッセージを入力してください', 'error');
    return;
  }

  const messageId = sel.value     ? parseInt(sel.value)     : null;
  const senderId  = senderSel.value ? parseInt(senderSel.value) : null;

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>送信中...';

  try {
    const res = await axios.post(`${API_BASE}/api/red-list/discord/send`, {
      studentId,
      yearMonth,
      studentName,           // サーバー側で 〇〇 置換に使用
      messageId,
      messageContent: messageId ? undefined : content,
      senderId               // 送信者ID（予約URL付加）
    }, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });

    if (res.data.success) {
      showNotification(`${studentName} 様に Discord メッセージを送信しました`, 'success');
      closeRedListDiscordModal();

      // サーバーが返した担当者名をローカルデータへ即時反映
      if (res.data.assignedTo) {
        const entry = currentRedListData.find(d => d.student_id === studentId);
        if (entry) entry.assigned_to = res.data.assignedTo;
      }

      // ログを再取得してカードを再描画
      await fetchRedListDiscordLogs(yearMonth);
      if (currentRedListTab === 'current') {
        renderRedListCurrentList();
      } else if (currentRedListTab === 'history') {
        renderRedListHistoryList();
      }
    } else {
      showNotification(res.data.error || '送信に失敗しました', 'error');
    }
  } catch (e) {
    console.error('Discord send error:', e);
    showNotification(e.response?.data?.error || '送信に失敗しました', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fab fa-discord mr-1"></i>送信';
  }
}

// ═══════════════════════════════════════════════════════════════
//  送信メッセージ管理タブ
// ═══════════════════════════════════════════════════════════════

async function loadRedListMessages(silent = false) {
  const loadingEl  = document.getElementById('redlist-messages-loading');
  const contentEl  = document.getElementById('redlist-messages-content');
  if (!silent && loadingEl) loadingEl.classList.remove('hidden');

  try {
    const res = await axios.get(`${API_BASE}/api/red-list/messages`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    if (res.data.success) {
      redListMessages = res.data.data;
      if (!silent) renderRedListMessages();
    }
  } catch (e) {
    console.error('loadRedListMessages error:', e);
    if (!silent && contentEl) {
      contentEl.innerHTML = '<div class="text-center py-8 text-red-600">読み込みに失敗しました</div>';
    }
  } finally {
    if (!silent && loadingEl) loadingEl.classList.add('hidden');
  }
}

function renderRedListMessages() {
  const contentEl = document.getElementById('redlist-messages-content');
  if (!contentEl) return;

  if (redListMessages.length === 0) {
    contentEl.innerHTML = `
      <div class="text-center py-12 text-gray-500">
        <i class="fab fa-discord text-5xl text-indigo-200 mb-4"></i>
        <p class="text-lg font-medium">送信メッセージがありません</p>
        <p class="text-sm mt-1">「新規作成」ボタンからテンプレートを追加してください</p>
      </div>`;
    return;
  }

  contentEl.innerHTML = redListMessages.map(m => {
    const created = new Date(m.created_at).toLocaleDateString('ja-JP',
      { timeZone: 'Asia/Tokyo', year:'numeric', month:'numeric', day:'numeric' });
    const imgBadge = m.has_image
      ? `<span class="inline-flex items-center text-xs text-indigo-500 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 ml-2"><i class="fas fa-image mr-1"></i>画像あり</span>`
      : '';
    return `
      <div class="border border-gray-200 rounded-lg p-4 mb-3 hover:border-indigo-300 transition">
        <div class="flex justify-between items-start">
          <div class="flex-1 min-w-0 mr-4">
            <div class="flex items-center flex-wrap gap-1">
              <h4 class="font-semibold text-gray-800 text-sm">${escapeHtml(m.title)}</h4>
              ${imgBadge}
            </div>
            <p class="text-xs text-gray-400 mt-0.5">${created} 作成 ／ ${m.created_by || '-'}</p>
            <p class="text-sm text-gray-600 mt-2 whitespace-pre-wrap line-clamp-3">${escapeHtml(m.content)}</p>
          </div>
          <div class="flex space-x-2 flex-shrink-0">
            <button onclick="openRedListTestSendModal(${m.id}, '${escapeHtml(m.title)}')"
                    class="text-green-600 hover:text-green-800 text-sm px-2 py-1 rounded border border-green-200 hover:bg-green-50 transition"
                    title="テスト送信">
              <i class="fas fa-flask"></i>
            </button>
            <button onclick="openRedListMessageModal(${m.id})"
                    class="text-indigo-600 hover:text-indigo-800 text-sm px-2 py-1 rounded border border-indigo-200 hover:bg-indigo-50 transition">
              <i class="fas fa-edit"></i>
            </button>
            <button onclick="deleteRedListMessage(${m.id}, '${escapeHtml(m.title)}')"
                    class="text-red-500 hover:text-red-700 text-sm px-2 py-1 rounded border border-red-200 hover:bg-red-50 transition">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
//  メッセージ編集モーダル
// ═══════════════════════════════════════════════════════════════

function openRedListMessageModal(id = null) {
  document.getElementById('redlist-msg-edit-id').value = id || '';
  document.getElementById('redlist-msg-edit-name').value = '';
  document.getElementById('redlist-msg-edit-content').value = '';
  document.getElementById('redlist-msg-edit-title').textContent =
    id ? 'メッセージ編集' : 'メッセージ作成';
  // 画像フィールドをリセット
  document.getElementById('redlist-msg-edit-image').value = '';
  document.getElementById('redlist-msg-edit-remove-image').value = 'false';
  document.getElementById('redlist-msg-edit-img-new-wrap').classList.add('hidden');
  document.getElementById('redlist-msg-edit-img-current').classList.add('hidden');

  if (id) {
    const msg = redListMessages.find(m => m.id === id);
    if (msg) {
      document.getElementById('redlist-msg-edit-name').value    = msg.title;
      document.getElementById('redlist-msg-edit-content').value = msg.content;
      // 既存画像がある場合はプレビュー表示
      if (msg.has_image) {
        const imgWrap    = document.getElementById('redlist-msg-edit-img-current');
        const imgPreview = document.getElementById('redlist-msg-edit-img-preview');
        imgPreview.src   = `${API_BASE}/api/red-list/messages/${id}/image`;
        imgWrap.classList.remove('hidden');
      }
    }
  }

  document.getElementById('redlist-msg-edit-modal').classList.remove('hidden');
}

function closeRedListMessageModal() {
  document.getElementById('redlist-msg-edit-modal').classList.add('hidden');
}

/** 「既存画像を削除」ボタン */
function removeRedListMessageImage() {
  document.getElementById('redlist-msg-edit-remove-image').value = 'true';
  document.getElementById('redlist-msg-edit-img-current').classList.add('hidden');
}

/** ファイル選択時の新しい画像プレビュー */
function onRedListImageSelected(input) {
  const file    = input.files[0];
  const newWrap = document.getElementById('redlist-msg-edit-img-new-wrap');
  const newImg  = document.getElementById('redlist-msg-edit-img-new');
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      newImg.src = e.target.result;
      newWrap.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
    // 新しい画像を追加するときは「削除」フラグをリセット
    document.getElementById('redlist-msg-edit-remove-image').value = 'false';
  } else {
    newWrap.classList.add('hidden');
    newImg.src = '';
  }
}

async function saveRedListMessage() {
  const id          = document.getElementById('redlist-msg-edit-id').value;
  const title       = document.getElementById('redlist-msg-edit-name').value.trim();
  const content     = document.getElementById('redlist-msg-edit-content').value.trim();
  const imageFile   = document.getElementById('redlist-msg-edit-image').files[0];
  const removeImage = document.getElementById('redlist-msg-edit-remove-image').value === 'true';

  if (!title || !content) {
    showNotification('タイトルとメッセージ本文を入力してください', 'error');
    return;
  }

  try {
    // 画像あり または 削除フラグあり → multipart/form-data
    let res;
    if (imageFile || removeImage) {
      const formData = new FormData();
      formData.append('title',       title);
      formData.append('content',     content);
      if (imageFile) {
        formData.append('image', imageFile, imageFile.name);
      }
      if (removeImage) {
        formData.append('removeImage', 'true');
      }
      if (id) {
        res = await axios.put(`${API_BASE}/api/red-list/messages/${id}`,
          formData,
          { headers: { 'Authorization': `Bearer ${sessionToken}` } }
        );
      } else {
        res = await axios.post(`${API_BASE}/api/red-list/messages`,
          formData,
          { headers: { 'Authorization': `Bearer ${sessionToken}` } }
        );
      }
    } else {
      // テキストのみ → JSON
      if (id) {
        res = await axios.put(`${API_BASE}/api/red-list/messages/${id}`,
          { title, content },
          { headers: { 'Authorization': `Bearer ${sessionToken}` } }
        );
      } else {
        res = await axios.post(`${API_BASE}/api/red-list/messages`,
          { title, content },
          { headers: { 'Authorization': `Bearer ${sessionToken}` } }
        );
      }
    }

    if (res.data.success) {
      showNotification(id ? 'メッセージを更新しました' : 'メッセージを作成しました', 'success');
      closeRedListMessageModal();
      await loadRedListMessages();
    } else {
      showNotification(res.data.error || '保存に失敗しました', 'error');
    }
  } catch (e) {
    console.error('saveRedListMessage error:', e);
    showNotification(e.response?.data?.error || '保存に失敗しました', 'error');
  }
}

async function deleteRedListMessage(id, title) {
  if (!confirm(`「${title}」を削除してもよいですか？`)) return;
  try {
    const res = await axios.delete(`${API_BASE}/api/red-list/messages/${id}`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    if (res.data.success) {
      showNotification('メッセージを削除しました', 'success');
      await loadRedListMessages();
    } else {
      showNotification(res.data.error || '削除に失敗しました', 'error');
    }
  } catch (e) {
    showNotification(e.response?.data?.error || '削除に失敗しました', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
//  テスト送信モーダル
// ═══════════════════════════════════════════════════════════════

function openRedListTestSendModal(messageId, messageTitle) {
  document.getElementById('redlist-test-send-message-id').value = messageId;
  document.getElementById('redlist-test-send-title').textContent = messageTitle;

  // 送信者ドロップダウンを最新状態で描画
  const sel = document.getElementById('redlist-test-send-sender-select');
  sel.innerHTML = '<option value="">送信者を選択しない</option>';
  redListSenders.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    opt.dataset.bookingUrl = s.booking_url;
    sel.appendChild(opt);
  });
  sel.value = '';
  document.getElementById('redlist-test-send-booking-url-wrap').classList.add('hidden');
  document.getElementById('redlist-test-send-booking-url-preview').textContent = '';

  document.getElementById('redlist-test-send-modal').classList.remove('hidden');
}

function closeRedListTestSendModal() {
  document.getElementById('redlist-test-send-modal').classList.add('hidden');
  document.getElementById('redlist-test-send-message-id').value = '';
  document.getElementById('redlist-test-send-title').textContent = '';
  document.getElementById('redlist-test-send-sender-select').value = '';
  document.getElementById('redlist-test-send-booking-url-wrap').classList.add('hidden');
  document.getElementById('redlist-test-send-booking-url-preview').textContent = '';
}

function onRedListTestSendSenderChange() {
  const sel     = document.getElementById('redlist-test-send-sender-select');
  const opt     = sel.options[sel.selectedIndex];
  const urlWrap = document.getElementById('redlist-test-send-booking-url-wrap');
  const urlSpan = document.getElementById('redlist-test-send-booking-url-preview');
  if (opt && opt.dataset.bookingUrl) {
    urlSpan.textContent = opt.dataset.bookingUrl;
    urlWrap.classList.remove('hidden');
  } else {
    urlWrap.classList.add('hidden');
    urlSpan.textContent = '';
  }
}

async function executeRedListTestSend() {
  const messageId = document.getElementById('redlist-test-send-message-id').value;
  const senderSel = document.getElementById('redlist-test-send-sender-select');
  const senderId  = senderSel.value ? parseInt(senderSel.value) : null;
  const btn       = document.getElementById('redlist-test-send-btn');

  if (!messageId) {
    showNotification('メッセージが指定されていません', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>送信中...';

  try {
    const res = await axios.post(`${API_BASE}/api/red-list/discord/test-send`, {
      messageId: parseInt(messageId),
      senderId
    }, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });

    if (res.data.success) {
      showNotification('テスト送信が完了しました ✓', 'success');
      closeRedListTestSendModal();
    } else {
      showNotification(res.data.error || 'テスト送信に失敗しました', 'error');
    }
  } catch (e) {
    console.error('Test send error:', e);
    showNotification(e.response?.data?.error || 'テスト送信に失敗しました', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i>テスト送信';
  }
}

// ═══════════════════════════════════════════════════════════════
//  送信者管理タブ
// ═══════════════════════════════════════════════════════════════

async function loadRedListSenders(silent = false) {
  const loadingEl = document.getElementById('redlist-senders-loading');
  const contentEl = document.getElementById('redlist-senders-content');
  if (!silent && loadingEl) loadingEl.classList.remove('hidden');

  try {
    const res = await axios.get(`${API_BASE}/api/red-list/senders`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    if (res.data.success) {
      redListSenders = res.data.data;
      if (!silent) renderRedListSenders();
    }
  } catch (e) {
    console.error('loadRedListSenders error:', e);
    if (!silent && contentEl) {
      contentEl.innerHTML = '<div class="text-center py-8 text-red-600">読み込みに失敗しました</div>';
    }
  } finally {
    if (!silent && loadingEl) loadingEl.classList.add('hidden');
  }
}

function renderRedListSenders() {
  const contentEl = document.getElementById('redlist-senders-content');
  if (!contentEl) return;

  if (redListSenders.length === 0) {
    contentEl.innerHTML = `
      <div class="text-center py-12 text-gray-500">
        <i class="fas fa-user-tie text-5xl text-indigo-200 mb-4"></i>
        <p class="text-lg font-medium">送信者が登録されていません</p>
        <p class="text-sm mt-1">「新規追加」ボタンから送信者を追加してください</p>
      </div>`;
    return;
  }

  contentEl.innerHTML = redListSenders.map(s => {
    const updated = new Date(s.updated_at).toLocaleDateString('ja-JP',
      { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' });
    return `
      <div class="border border-gray-200 rounded-lg p-4 mb-3 hover:border-indigo-300 transition">
        <div class="flex justify-between items-start">
          <div class="flex-1 min-w-0 mr-4">
            <div class="flex items-center gap-2">
              <i class="fas fa-user-tie text-indigo-400"></i>
              <h4 class="font-semibold text-gray-800 text-sm">${escapeHtml(s.name)}</h4>
            </div>
            <div class="flex items-center gap-1 mt-1">
              <i class="fas fa-calendar-check text-green-400 text-xs"></i>
              <a href="${escapeHtml(s.booking_url)}" target="_blank" rel="noopener"
                 class="text-xs text-indigo-600 hover:underline break-all">${escapeHtml(s.booking_url)}</a>
            </div>
            <p class="text-xs text-gray-400 mt-1">最終更新: ${updated} ／ ${s.created_by || '-'}</p>
          </div>
          <div class="flex space-x-2 flex-shrink-0">
            <button onclick="openRedListSenderModal(${s.id})"
                    class="text-indigo-600 hover:text-indigo-800 text-sm px-2 py-1 rounded border border-indigo-200 hover:bg-indigo-50 transition">
              <i class="fas fa-edit"></i>
            </button>
            <button onclick="deleteRedListSender(${s.id}, '${escapeHtml(s.name)}')"
                    class="text-red-500 hover:text-red-700 text-sm px-2 py-1 rounded border border-red-200 hover:bg-red-50 transition">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function openRedListSenderModal(id = null) {
  document.getElementById('redlist-sender-edit-id').value = id || '';
  document.getElementById('redlist-sender-edit-name').value = '';
  document.getElementById('redlist-sender-edit-url').value = '';
  document.getElementById('redlist-sender-edit-title').textContent =
    id ? '送信者編集' : '送信者追加';

  if (id) {
    const sender = redListSenders.find(s => s.id === id);
    if (sender) {
      document.getElementById('redlist-sender-edit-name').value = sender.name;
      document.getElementById('redlist-sender-edit-url').value  = sender.booking_url;
    }
  }

  document.getElementById('redlist-sender-edit-modal').classList.remove('hidden');
}

function closeRedListSenderModal() {
  document.getElementById('redlist-sender-edit-modal').classList.add('hidden');
}

async function saveRedListSender() {
  const id          = document.getElementById('redlist-sender-edit-id').value;
  const name        = document.getElementById('redlist-sender-edit-name').value.trim();
  const booking_url = document.getElementById('redlist-sender-edit-url').value.trim();

  if (!name || !booking_url) {
    showNotification('送信者名と予約URLを入力してください', 'error');
    return;
  }

  try {
    let res;
    if (id) {
      res = await axios.put(`${API_BASE}/api/red-list/senders/${id}`,
        { name, booking_url },
        { headers: { 'Authorization': `Bearer ${sessionToken}` } }
      );
    } else {
      res = await axios.post(`${API_BASE}/api/red-list/senders`,
        { name, booking_url },
        { headers: { 'Authorization': `Bearer ${sessionToken}` } }
      );
    }

    if (res.data.success) {
      showNotification(id ? '送信者を更新しました' : '送信者を追加しました', 'success');
      closeRedListSenderModal();
      await loadRedListSenders();
    } else {
      showNotification(res.data.error || '保存に失敗しました', 'error');
    }
  } catch (e) {
    console.error('saveRedListSender error:', e);
    showNotification(e.response?.data?.error || '保存に失敗しました', 'error');
  }
}

async function deleteRedListSender(id, name) {
  if (!confirm(`「${name}」を削除してもよいですか？`)) return;
  try {
    const res = await axios.delete(`${API_BASE}/api/red-list/senders/${id}`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    if (res.data.success) {
      showNotification('送信者を削除しました', 'success');
      // 送信モーダルのドロップダウンもリセット
      redListSenders = [];
      await loadRedListSenders();
    } else {
      showNotification(res.data.error || '削除に失敗しました', 'error');
    }
  } catch (e) {
    showNotification(e.response?.data?.error || '削除に失敗しました', 'error');
  }
}
