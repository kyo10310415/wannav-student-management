// API Base URL
const API_BASE = '';

// State
let students = [];
let tutors = [];
let satisfactionData = {}; // tutor_name -> { yearMonth -> { average, count, reasons } }
let lessonStats = {};
let lessonDates = {}; // student_id -> [dates]
let cachedNotionUrls = {}; // student_id -> notion_url
let currentMonth = new Date();
let selectedTutor = 'all';
let reservationCountFilter = 'all'; // 'all', 'above2', 'below2'
let selectedTeam = 'all'; // チームフィルター用
let currentTab = 'active'; // 'active', 'preparing', 'suspended', 'graduated', 'cancelled', 'today'
let activeSubTab = 'lesson'; // 'lesson', 'pro', 'permanent', 'enrolled' (for active tab only)
let currentPage = 'today'; // 'reservations', 'students', 'tutors', 'today', 'helpers', 'schedules'
let schedules = []; // Tutor schedules data

// Schedule filters
let selectedScheduleYear = new Date().getFullYear();
let selectedScheduleMonth = new Date().getMonth() + 1; // 1-12
let selectedKeyword = 'all'; // all, ロープレ, 1on1, チームMTG, チーム研修
let selectedDateRange = 'all'; // all, this_week, next_week, this_month, next_month
let selectedLeader = 'all'; // all or tutor_name
let scheduleViewMode = 'list'; // list or calendar

// Column filters and sort state for student management page
let columnFilters = {}; // { columnName: selectedValue }
let sortColumn = null; // Current sort column name
let sortDirection = 'asc'; // 'asc' or 'desc'

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
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
  }
  // Default is 'today' (already set)
  
  renderHeader();
  await loadInitialData();
  await renderApp();
});

// Render header
function renderHeader() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="min-h-screen bg-gray-50">
      <!-- Header -->
      <header class="bg-blue-600 text-white shadow-lg">
        <div class="container mx-auto px-4 py-6">
          <h1 class="text-3xl font-bold">
            <i class="fas fa-users mr-3"></i>
            WannaV 生徒様管理システム
          </h1>
          <p class="text-blue-100 mt-2">VTuber育成スクール生徒管理</p>
          
          <!-- Navigation -->
          <nav class="mt-6 flex gap-2 flex-wrap">
            <button id="nav-today" onclick="changePage('today')" class="px-6 py-2 rounded-lg font-semibold transition ${currentPage === 'today' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}">
              <i class="fas fa-calendar-day mr-2"></i>今日のレッスン
            </button>
            <button id="nav-reservations" onclick="changePage('reservations')" class="px-6 py-2 rounded-lg font-semibold transition ${currentPage === 'reservations' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}">
              <i class="fas fa-calendar-check mr-2"></i>予約管理
            </button>
            <button id="nav-students" onclick="changePage('students')" class="px-6 py-2 rounded-lg font-semibold transition ${currentPage === 'students' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}">
              <i class="fas fa-user-graduate mr-2"></i>生徒管理
            </button>
            <button id="nav-tutors" onclick="changePage('tutors')" class="px-6 py-2 rounded-lg font-semibold transition ${currentPage === 'tutors' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}">
              <i class="fas fa-chalkboard-teacher mr-2"></i>Tutor管理
            </button>
            <button id="nav-helpers" onclick="changePage('helpers')" class="px-6 py-2 rounded-lg font-semibold transition ${currentPage === 'helpers' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}">
              <i class="fas fa-hands-helping mr-2"></i>助っ人待ち
            </button>
            <button id="nav-schedules" onclick="changePage('schedules')" class="px-6 py-2 rounded-lg font-semibold transition ${currentPage === 'schedules' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}">
              <i class="fas fa-calendar-check mr-2"></i>Tutorスケジュール
            </button>
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
}

// Load initial data
async function loadInitialData() {
  try {
    // Sync data from Notion
    await axios.get(`${API_BASE}/api/students/sync`);
    await axios.get(`${API_BASE}/api/tutors/sync`);
    
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
    
    // Load lesson stats and dates for current month
    await loadLessonStats();
    await loadLessonDates();
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
      
      lessonDates[lesson.student_id].push({
        date: utcDate,
        formatted: `${parseInt(monthStr)}/${parseInt(dayStr)}`
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

// Render main app
async function renderApp() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  
  // Render based on current page
  if (currentPage === 'reservations') {
    renderReservationsPage();
  } else if (currentPage === 'students') {
    renderStudentsPage();
  } else if (currentPage === 'tutors') {
    renderTutorsPage();
  } else if (currentPage === 'today') {
    await renderTodayLessonsPage();
  } else if (currentPage === 'helpers') {
    await renderHelpersPage();
  } else if (currentPage === 'schedules') {
    await renderSchedulesPage();
  }
}

// Change page
async function changePage(page) {
  currentPage = page;
  renderHeader();
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
          <select id="tutor-filter-reservations" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value="${selectedTutor}">
            <option value="all">すべてのTutor</option>
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
      <div class="mt-4 flex gap-2">
        <button onclick="refreshData()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
          <i class="fas fa-sync-alt mr-2"></i>データ更新
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
}

// Get tutor options for filter (only cached tutors)
function getTutorOptions() {
  // Get unique notion_names that exist in tutors array (cached tutors only)
  const cachedTutorNotionNames = new Set(tutors.map(t => t.notion_name).filter(Boolean));
  
  // Get unique notion_names from students that are also in cached tutors
  const uniqueNotionNames = [...new Set(
    students
      .map(s => s.homeroom_tutor)
      .filter(notionName => notionName && cachedTutorNotionNames.has(notionName))
  )];
  
  // Map notion_name to tutor_name for display
  return uniqueNotionNames
    .map(notionName => {
      const displayName = getTutorDisplayName(notionName);
      return `<option value="${notionName}">${displayName}</option>`;
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
        <td colspan="11" class="px-6 py-4 text-center text-gray-500">
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
      ? dates.map(d => d.formatted).join(', ')
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
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${student.name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${student.status || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${student.contract_plan || '-'}</td>
        <td class="px-3 py-3 text-sm text-gray-600" style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${student.character_name || '-'}">${student.character_name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${getTutorDisplayName(student.homeroom_tutor)}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold ${ student.lesson_progress ? 'text-blue-600' : 'text-gray-400'}">${student.lesson_progress ? `レッスン${student.lesson_progress}` : '-'}</td>
        <td class="px-3 py-3 whitespace-nowrap text-xs text-center ${paymentColorClass}">${paymentStatus}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm font-bold">
          <span class="px-2 py-1 rounded-full text-xs ${getLessonCountBadgeColor(lessonCount)}">
            ${lessonCount}回
          </span>
        </td>
        <td class="px-4 py-3 text-sm text-gray-600" style="max-width: 180px;">
          <div class="overflow-x-auto whitespace-nowrap text-xs">${datesStr}</div>
        </td>
        <td class="px-3 py-3 whitespace-nowrap text-center">
          <div class="flex gap-2 justify-center">
            ${notionUrl ? `<a href="${notionUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-blue-600 transition" title="Notionページを開く"><i class="fas fa-file-alt text-lg"></i></a>` : '<span class="text-gray-300"><i class="fas fa-file-alt text-lg"></i></span>'}
            ${discordUrl ? `<a href="${discordUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-indigo-600 transition" title="Discordを開く"><i class="fab fa-discord text-lg"></i></a>` : '<span class="text-gray-300"><i class="fab fa-discord text-lg"></i></span>'}
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
    await loadInitialData();
    await renderApp();
    alert('データを更新しました');
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
          <select id="tutor-filter-students" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value="${selectedTutor}">
            <option value="all">すべてのTutor</option>
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
      <div class="overflow-x-auto">
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
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div class="flex items-center justify-center gap-2">
                  <span>欠席回数</span>
                  <button onclick="toggleSort('result_absence')" class="hover:text-blue-600 transition">
                    <i class="fas fa-sort ${sortColumn === 'result_absence' ? (sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : ''}"></i>
                  </button>
                </div>
              </th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リンク</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${renderStudentRowsSimple()}
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
  `;
  
  // Set tutor filter and add event listener
  const selectElement = document.getElementById('tutor-filter-students');
  if (selectElement) {
    selectElement.value = selectedTutor;
    selectElement.addEventListener('change', async (e) => {
      await filterByTutor(e.target.value);
    });
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

// Render student rows (simple version with result scores and absence count)
function renderStudentRowsSimple() {
  const filtered = getFilteredStudents();
  
  if (filtered.length === 0) {
    return `
      <tr>
        <td colspan="13" class="px-4 py-8 text-center text-gray-500">
          <i class="fas fa-inbox text-4xl mb-2"></i>
          <p>該当する生徒が見つかりません</p>
        </td>
      </tr>
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
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${student.student_id || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${student.name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${student.status || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${student.contract_plan || '-'}</td>
        <td class="px-3 py-3 text-sm text-gray-600" style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${student.character_name || '-'}">${student.character_name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${getTutorDisplayName(student.homeroom_tutor)}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold ${rowBgColor} ${ student.lesson_progress ? 'text-blue-600' : 'text-gray-400'}">${student.lesson_progress ? `レッスン${student.lesson_progress}` : '-'}</td>
        <td class="px-3 py-3 whitespace-nowrap text-xs text-center text-gray-700">${lessonStartDate}</td>
        <td class="px-2 py-3 whitespace-nowrap text-sm text-center font-semibold text-blue-600">${continuedMonths}ヶ月</td>
        <td class="px-2 py-3 whitespace-nowrap text-sm text-center font-semibold ${resultOverallColor}">${resultOverall}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold ${absenceColorClass}">${absenceCount}回</td>
        <td class="px-3 py-3 whitespace-nowrap text-center">
          <div class="flex gap-2 justify-center">
            ${notionUrl ? `<a href="${notionUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-blue-600 transition" title="Notionページを開く"><i class="fas fa-file-alt text-lg"></i></a>` : '<span class="text-gray-300"><i class="fas fa-file-alt text-lg"></i></span>'}
            ${discordUrl ? `<a href="${discordUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-indigo-600 transition" title="Discordを開く"><i class="fab fa-discord text-lg"></i></a>` : '<span class="text-gray-300"><i class="fab fa-discord text-lg"></i></span>'}
          </div>
        </td>
      </tr>
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
      <div class="flex gap-2 items-center">
        <button onclick="refreshData()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
          <i class="fas fa-sync-alt mr-2"></i>データ更新
        </button>
        
        <!-- Team Filter -->
        <div class="flex items-center gap-2 ml-4">
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
        統計情報 ${selectedTeam !== 'all' ? `<span class="text-sm text-blue-600">(${selectedTeam}チーム)</span>` : '<span class="text-sm text-gray-500">(全体)</span>'}
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
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ステータス</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${renderTutorRows()}
          </tbody>
        </table>
      </div>
    </div>
  `;
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
  
  const currentYearMonth = `${currentMonth.getFullYear()}/${currentMonth.getMonth() + 1}`;
  
  // Get unique teams
  const uniqueTeams = [...new Set(allActiveTutors.map(t => t.team || '未所属'))].sort();
  
  // Calculate overall statistics
  let overallSatisfaction = 0;
  let overallCollectionRate = 0;
  let overallSatisfactionScore = 0;
  let overallValidCount = 0;
  
  allActiveTutors.forEach(tutor => {
    const activeStudentCount = students.filter(s => 
      s.homeroom_tutor === tutor.notion_name &&
      s.status === 'アクティブ' &&
      s.contract_plan !== '永久会員' &&
      s.contract_plan !== '在籍プラン'
    ).length;
    
    const tutorSatisfactionData = satisfactionData[tutor.tutor_name] || {};
    const currentMonthData = tutorSatisfactionData[currentYearMonth];
    
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
      const activeStudentCount = students.filter(s => 
        s.homeroom_tutor === tutor.notion_name &&
        s.status === 'アクティブ' &&
        s.contract_plan !== '永久会員' &&
        s.contract_plan !== '在籍プラン'
      ).length;
      
      const tutorSatisfactionData = satisfactionData[tutor.tutor_name] || {};
      const currentMonthData = tutorSatisfactionData[currentYearMonth];
      
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
      satisfactionScore: teamValidCount > 0 ? (teamSatisfactionScore / teamValidCount).toFixed(2) : '-'
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
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${uniqueTeams.map(team => {
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

  // Get current month in YYYY/M format
  const currentYearMonth = `${currentMonth.getFullYear()}/${currentMonth.getMonth() + 1}`;

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
    
    // Get satisfaction data for this tutor
    const tutorSatisfactionData = satisfactionData[tutor.tutor_name] || {};
    const currentMonthData = tutorSatisfactionData[currentYearMonth];
    
    // レッスン満足度 (平均 × 10、100がMAX、小数第2位まで)
    let satisfactionAverage = '-';
    let satisfactionValue = 0;
    let satisfactionColor = 'text-purple-600'; // デフォルト色
    if (currentMonthData) {
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
    if (activeStudentCount > 0 && satisfactionCount > 0) {
      collectionRateValue = (satisfactionCount / activeStudentCount * 100);
      collectionRate = `${collectionRateValue.toFixed(1)}%`;
      // 50未満は赤文字
      if (collectionRateValue < 50) {
        collectionRateColor = 'text-red-600';
      }
    } else if (activeStudentCount > 0 && satisfactionCount === 0) {
      collectionRate = '0.0%';
      collectionRateColor = 'text-red-600'; // 0%は赤文字
    }
    
    // 満足度スコア (レッスン満足度 × 回収率(数値) / 100)
    // 例: 満足度99.63, 回収率25% → 99.63 × 25 / 100 = 24.9075 → 24.91
    let satisfactionScore = '-';
    let satisfactionScoreValue = 0;
    let satisfactionScoreColor = 'text-indigo-600'; // デフォルト色
    if (satisfactionValue > 0 && collectionRateValue > 0) {
      satisfactionScoreValue = satisfactionValue * collectionRateValue / 100;
      satisfactionScore = satisfactionScoreValue.toFixed(2); // 小数第2位まで
      // 60未満は赤文字
      if (satisfactionScoreValue < 60) {
        satisfactionScoreColor = 'text-red-600';
      }
    }
    
    // 満足度ボタン (表示月にデータがある場合のみ表示)
    const satisfactionButton = currentMonthData ? 
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
    
    const helperRequestCount = tutor.helper_request_count || 0;
    const helperAcceptedCount = tutor.helper_accepted_count || 0;
    const rescheduleCount = tutor.reschedule_count || 0;
    
    const requestColor = getCounterColor(helperRequestCount);
    const rescheduleColor = getCounterColor(rescheduleCount);
    
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
        <td class="px-4 py-3 whitespace-nowrap text-sm ${statusClass}">${tutor.status || '-'}</td>
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
async function renderTodayLessonsPage() {
  const content = document.getElementById('content');
  
  // Load today's lesson dates (always loads current month)
  await loadTodayLessonDates();
  
  // Get today's date
  const today = new Date();
  const todayDay = today.getDate();
  const todayMonth = today.getMonth() + 1;
  
  console.log(`Today: ${todayMonth}/${todayDay}`);
  console.log('Total students:', students.length);
  console.log('Lesson dates sample:', Object.keys(lessonDates).slice(0, 5).map(id => ({
    id,
    dates: lessonDates[id].map(d => d.formatted)
  })));
  
  // Filter students who have lessons today
  let todayStudents = students.filter(student => {
    const dates = lessonDates[student.student_id] || [];
    const hasLessonToday = dates.some(d => {
      // Compare formatted date strings (M/D format)
      const todayFormatted = `${todayMonth}/${todayDay}`;
      return d.formatted === todayFormatted;
    });
    return hasLessonToday;
  });
  
  console.log('Today students count (before filter):', todayStudents.length);
  console.log('Selected tutor:', selectedTutor);
  
  // Apply tutor filter
  if (selectedTutor !== 'all') {
    console.log('Filtering by tutor:', selectedTutor);
    todayStudents = todayStudents.filter(s => s.homeroom_tutor === selectedTutor);
    console.log('Today students count (after filter):', todayStudents.length);
  }
  
  content.innerHTML = `
    <!-- Header with Lesson Report Link -->
    <div class="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg shadow-lg p-6 mb-6 text-white">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-bold mb-2">
            <i class="fas fa-calendar-day mr-2"></i>
            今日のレッスン (${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日)
          </h2>
          <p class="text-blue-100">今日レッスンがある生徒様: ${todayStudents.length}名</p>
        </div>
        <div>
          <a href="https://docs.google.com/forms/d/e/1FAIpQLSfT2_mAhf3_ZwZAaOUrIADgGXD4BxWpVeh9DIZ-tJkIfD3ZSg/viewform" 
             target="_blank" 
             rel="noopener noreferrer"
             class="inline-flex items-center px-6 py-3 bg-white text-blue-600 font-semibold rounded-lg hover:bg-blue-50 transition shadow-lg">
            <i class="fas fa-file-alt mr-2"></i>
            レッスン報告フォーム
          </a>
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
          <select id="tutor-filter-today" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value="${selectedTutor}">
            <option value="all">すべてのTutor</option>
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
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">キャラ名</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン進捗</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">継続月数</th>
              <th class="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リザルト総合</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">欠席回数</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リンク</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${renderTodayStudentRows(todayStudents)}
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
function renderTodayStudentRows(todayStudents) {
  if (todayStudents.length === 0) {
    return `
      <tr>
        <td colspan="9" class="px-4 py-8 text-center text-gray-500">
          <i class="fas fa-calendar-times text-4xl mb-2"></i>
          <p>今日レッスンの生徒様はいません</p>
        </td>
      </tr>
    `;
  }

  return todayStudents.map(student => {
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
    
    return `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${student.student_id || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${student.name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${getTutorDisplayName(student.homeroom_tutor)}</td>
        <td class="px-3 py-3 text-sm text-gray-600" style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${student.character_name || '-'}">${student.character_name || '-'}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold ${ student.lesson_progress ? 'text-blue-600' : 'text-gray-400'}">${student.lesson_progress ? `レッスン${student.lesson_progress}` : '-'}</td>
        <td class="px-2 py-3 whitespace-nowrap text-sm text-center font-semibold text-blue-600">${continuedMonths}ヶ月</td>
        <td class="px-2 py-3 whitespace-nowrap text-sm text-center font-semibold ${resultOverallColor}">${resultOverall}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold ${absenceColorClass}">${absenceCount}回</td>
        <td class="px-3 py-3 whitespace-nowrap text-center">
          <div class="flex gap-2 justify-center">
            ${notionUrl ? `<a href="${notionUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-blue-600 transition" title="Notionページを開く"><i class="fas fa-file-alt text-lg"></i></a>` : '<span class="text-gray-300"><i class="fas fa-file-alt text-lg"></i></span>'}
            ${discordUrl ? `<a href="${discordUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-600 hover:text-indigo-600 transition" title="Discordを開く"><i class="fab fa-discord text-lg"></i></a>` : '<span class="text-gray-300"><i class="fab fa-discord text-lg"></i></span>'}
          </div>
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
            <div class="text-sm text-gray-600">レッスン進捗: ${student.lesson_progress || 0}回</div>
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
            <p><span class="font-medium">レッスン進捗:</span> ${student.lesson_progress || 0}回</p>
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
              <p class="font-semibold">${student.lesson_progress || 0}回</p>
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
  } catch (error) {
    console.error('Error loading helper requests:', error);
    helperRequests = [];
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
        
        <!-- Second row: Filters -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          <!-- Keyword filter -->
          <select id="keyword-filter" onchange="handleKeywordFilterChange(this.value)" class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            <option value="all">すべてのキーワード</option>
            <option value="ロープレ">ロープレ</option>
            <option value="1on1">1on1</option>
            <option value="チームMTG">チームMTG</option>
            <option value="チーム研修">チーム研修</option>
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
        
        <!-- Third row: Actions -->
        <div class="flex gap-2">
          <button onclick="renderSchedulesPage()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
            <i class="fas fa-sync-alt mr-2"></i>データ更新
          </button>
          <button onclick="clearScheduleFilters()" class="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition">
            <i class="fas fa-times mr-2"></i>フィルタークリア
          </button>
        </div>
      </div>
    </div>

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
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">合計</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${renderAttendanceStatistics()}
          </tbody>
        </table>
      </div>
    </div>
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
function changeScheduleMonth(offset) {
  selectedScheduleMonth += offset;
  if (selectedScheduleMonth > 12) {
    selectedScheduleMonth = 1;
    selectedScheduleYear++;
  } else if (selectedScheduleMonth < 1) {
    selectedScheduleMonth = 12;
    selectedScheduleYear--;
  }
  renderSchedulesContent();
}

/**
 * Handle keyword filter change
 */
function handleKeywordFilterChange(value) {
  selectedKeyword = value;
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
  renderSchedulesContent();
}

/**
 * Render leader filter options
 */
function renderLeaderFilterOptions() {
  // Get unique leaders from schedules
  const leaders = [...new Set(schedules.map(s => s.leader_name).filter(Boolean))];
  leaders.sort();
  
  let html = '<option value="all">すべてのリーダー</option>';
  leaders.forEach(leader => {
    html += `<option value="${leader}">${leader}</option>`;
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
    if (selectedLeader !== 'all' && schedule.leader_name !== selectedLeader) {
      return false;
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
            
            // Keyword badge colors
            const keywordColors = {
              'ロープレ': 'bg-blue-100 text-blue-800',
              '1on1': 'bg-green-100 text-green-800',
              'チームMTG': 'bg-orange-100 text-orange-800',
              'チーム研修': 'bg-purple-100 text-purple-800'
            };
            const colorClass = keywordColors[keyword] || 'bg-gray-100 text-gray-800';
            
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
                  'チーム研修': 'bg-purple-200 border-purple-400'
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
        <td class="px-4 py-3 whitespace-nowrap text-sm font-bold text-blue-600">${counts.total}回</td>
      </tr>
    `;
  }).join('');
}


