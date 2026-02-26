// API Base URL
const API_BASE = '';

// State
let students = [];
let tutors = [];
let satisfactionData = {}; // tutor_name -> { yearMonth -> { average, count, reasons } }
let lessonStats = {};
let lessonDates = {}; // student_id -> [dates]
let currentMonth = new Date();
let selectedTutor = 'all';
let selectedTeam = 'all'; // チームフィルター用
let currentTab = 'active'; // 'active', 'preparing', 'suspended', 'graduated', 'cancelled', 'today'
let activeSubTab = 'lesson'; // 'lesson', 'pro', 'permanent', 'enrolled' (for active tab only)
let currentPage = 'today'; // 'reservations', 'students', 'tutors', 'today'

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
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
          <nav class="mt-6 flex gap-2">
            <button id="nav-reservations" onclick="changePage('reservations')" class="px-6 py-2 rounded-lg font-semibold transition ${currentPage === 'reservations' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}">
              <i class="fas fa-calendar-check mr-2"></i>予約管理
            </button>
            <button id="nav-students" onclick="changePage('students')" class="px-6 py-2 rounded-lg font-semibold transition ${currentPage === 'students' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}">
              <i class="fas fa-user-graduate mr-2"></i>生徒管理
            </button>
            <button id="nav-tutors" onclick="changePage('tutors')" class="px-6 py-2 rounded-lg font-semibold transition ${currentPage === 'tutors' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}">
              <i class="fas fa-chalkboard-teacher mr-2"></i>Tutor管理
            </button>
            <button id="nav-today" onclick="changePage('today')" class="px-6 py-2 rounded-lg font-semibold transition ${currentPage === 'today' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}">
              <i class="fas fa-calendar-day mr-2"></i>今日のレッスン
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
  const previousTutorFilter = selectedTutor;
  
  content.innerHTML = `
    <!-- Controls -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <select id="tutor-filter" onchange="filterByTutor(this.value)" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value="${selectedTutor}">
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
        <button onclick="sendReminders()" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">
          <i class="fas fa-bell mr-2"></i>リマインド送信
        </button>
      </div>
    </div>

    <!-- Statistics (exclude 正規退会, 無断キャンセル, and 永久会員) -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-chart-bar mr-2"></i>
        統計情報 <span class="text-sm text-gray-500">(正規退会・無断キャンセル・永久会員を除く)</span>
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
  
  // Set tutor filter value after rendering
  const tutorSelect = document.getElementById('tutor-filter');
  if (tutorSelect) {
    tutorSelect.value = previousTutorFilter;
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
  // Filter out graduated, cancelled students, and permanent members
  const activeStudents = students.filter(s => 
    s.status !== '正規退会' && 
    s.status !== '無断キャンセル' &&
    s.contract_plan !== '永久会員'
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
function filterByTutor(tutor) {
  selectedTutor = tutor;
  renderApp();
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
  const previousTutorFilter = selectedTutor;
  
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
          <select id="tutor-filter" onchange="filterByTutor(this.value)" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value="${selectedTutor}">
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

    <!-- Statistics (exclude 正規退会, 無断キャンセル, and 永久会員) -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-chart-bar mr-2"></i>
        統計情報 <span class="text-sm text-gray-500">(正規退会・無断キャンセル・永久会員を除く)</span>
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        ${renderStudentStatistics()}
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
              <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">キャラ名</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">担任Tutor</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン進捗</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">開始日</th>
              <th class="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">継続月数</th>
              <th class="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リザルト総合</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">欠席回数</th>
              <th class="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">リンク</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${renderStudentRowsSimple()}
          </tbody>
        </table>
      </div>
    </div>
  `;
  
  // Restore tutor filter value
  const selectElement = document.getElementById('tutor-filter');
  if (selectElement) {
    selectElement.value = previousTutorFilter;
  }
}

// Render student statistics (simpler version without lesson counts)
function renderStudentStatistics() {
  const filtered = students.filter(s => 
    s.status !== '正規退会' && 
    s.status !== '無断キャンセル' &&
    s.contract_plan !== '永久会員'
  );

  const total = filtered.length;
  const active = filtered.filter(s => s.status === 'アクティブ').length;
  const preparing = filtered.filter(s => s.status === 'レッスン準備中').length;
  const suspended = filtered.filter(s => s.status === '休会').length;

  return `
    <div class="bg-blue-50 p-4 rounded-lg">
      <div class="text-sm text-gray-600 mb-1">総生徒数</div>
      <div class="text-3xl font-bold text-blue-600">${total}名</div>
    </div>
    <div class="bg-green-50 p-4 rounded-lg">
      <div class="text-sm text-gray-600 mb-1">アクティブ</div>
      <div class="text-3xl font-bold text-green-600">${active}名</div>
    </div>
    <div class="bg-yellow-50 p-4 rounded-lg">
      <div class="text-sm text-gray-600 mb-1">休会中</div>
      <div class="text-3xl font-bold text-yellow-600">${suspended}名</div>
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
      <tr class="hover:bg-gray-50 ${rowBgColor}">
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${student.student_id || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${student.name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${student.status || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${student.contract_plan || '-'}</td>
        <td class="px-3 py-3 text-sm text-gray-600" style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${student.character_name || '-'}">${student.character_name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${getTutorDisplayName(student.homeroom_tutor)}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold ${ student.lesson_progress ? 'text-blue-600' : 'text-gray-400'}">${student.lesson_progress ? `レッスン${student.lesson_progress}` : '-'}</td>
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
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">メールアドレス</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">所属チーム</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">アクティブ生徒数</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">生徒数上限</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">残り受入可能数</th>
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
        <td colspan="11" class="px-4 py-8 text-center text-gray-500">
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
    
    return `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${tutor.employee_id || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${tutor.tutor_name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${tutor.email || '-'}</td>
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
  
  if (progressRate >= 1.0) {
    return { color: 'bg-blue-100', label: '正常' };
  } else if (progressRate >= 0.5) {
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
  const previousTutorFilter = selectedTutor;
  
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
    dates: lessonDates[id].map(d => `${d.date.getMonth()+1}/${d.date.getDate()}`)
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
  
  console.log('Today students count:', todayStudents.length);
  
  // Apply tutor filter
  if (selectedTutor !== 'all') {
    const tutorName = getTutorNotionName(selectedTutor);
    todayStudents = todayStudents.filter(s => s.homeroom_tutor === tutorName);
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
          <select id="tutor-filter-today" onchange="filterByTutor(this.value)" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" value="${selectedTutor}">
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
  
  // Restore tutor filter value
  const selectElement = document.getElementById('tutor-filter-today');
  if (selectElement) {
    selectElement.value = previousTutorFilter;
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
    
    // Lesson progress status
    const lessonProgress = student.lesson_progress || 0;
    const progressStatus = getLessonProgressStatus(lessonProgress, continuedMonths);
    const rowBgColor = progressStatus.color;
    
    return `
      <tr class="hover:bg-gray-50 ${rowBgColor}">
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
