// API Base URL
const API_BASE = '';

// State
let students = [];
let tutors = [];
let lessonStats = {};
let lessonDates = {}; // student_id -> [dates]
let currentMonth = new Date();
let selectedTutor = 'all';
let currentTab = 'active'; // 'active', 'preparing', 'enrolled', 'graduated', 'cancelled'
let activeSubTab = 'lesson'; // 'lesson', 'pro', 'permanent' (for active tab only)

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();
  await loadInitialData();
  renderApp();
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

// Load lesson dates for current month
async function loadLessonDates() {
  try {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth() + 1;
    
    const res = await axios.get(`${API_BASE}/api/lessons/month/${year}/${month}`);
    
    // Group dates by student_id
    lessonDates = {};
    res.data.data.forEach(lesson => {
      if (!lessonDates[lesson.student_id]) {
        lessonDates[lesson.student_id] = [];
      }
      const date = new Date(lesson.lesson_date);
      lessonDates[lesson.student_id].push({
        date: date,
        formatted: `${date.getMonth() + 1}/${date.getDate()}`
      });
    });
    
    // Sort dates
    Object.keys(lessonDates).forEach(studentId => {
      lessonDates[studentId].sort((a, b) => a.date - b.date);
    });
  } catch (error) {
    console.error('Error loading lesson dates:', error);
  }
}

// Render main app
function renderApp() {
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
        <button onclick="switchTab('enrolled')" class="px-6 py-3 rounded-lg font-semibold transition ${currentTab === 'enrolled' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
          <i class="fas fa-user-clock mr-2"></i>在籍プラン
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
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">今月の予約</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">レッスン日</th>
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

// Get tutor options for filter
function getTutorOptions() {
  // Get unique notion_names from students
  const uniqueNotionNames = [...new Set(students.map(s => s.homeroom_tutor).filter(Boolean))];
  
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
      <div class="text-3xl font-bold text-green-600">${threePlusLessons}</div>
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
        <td colspan="9" class="px-6 py-4 text-center text-gray-500">
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
    
    return `
      <tr class="hover:bg-gray-50 ${colorClass}">
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${student.student_id || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${student.name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${student.status || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${student.contract_plan || '-'}</td>
        <td class="px-3 py-3 text-sm text-gray-600" style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${student.character_name || '-'}">${student.character_name || '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${getTutorDisplayName(student.homeroom_tutor)}</td>
        <td class="px-3 py-3 whitespace-nowrap text-sm text-center font-semibold ${ student.lesson_progress ? 'text-blue-600' : 'text-gray-400'}">${student.lesson_progress ? `レッスン${student.lesson_progress}` : '-'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm font-bold">
          <span class="px-2 py-1 rounded-full text-xs ${getLessonCountBadgeColor(lessonCount)}">
            ${lessonCount}回
          </span>
        </td>
        <td class="px-4 py-3 text-sm text-gray-600" style="max-width: 180px;">
          <div class="overflow-x-auto whitespace-nowrap text-xs">${datesStr}</div>
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
      filtered = filtered.filter(s => s.contract_plan !== 'PROプラン' && s.contract_plan !== '永久会員');
    } else if (activeSubTab === 'pro') {
      filtered = filtered.filter(s => s.contract_plan === 'PROプラン');
    } else if (activeSubTab === 'permanent') {
      filtered = filtered.filter(s => s.contract_plan === '永久会員');
    }
  } else if (currentTab === 'preparing') {
    filtered = students.filter(s => s.status === 'レッスン準備中');
  } else if (currentTab === 'enrolled') {
    filtered = students.filter(s => s.status === '在籍プラン');
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
    'enrolled': '在籍プラン生徒一覧',
    'graduated': '正規退会生徒一覧',
    'cancelled': '無断キャンセル生徒一覧'
  };
  return titles[currentTab] || '生徒一覧';
}

// Render active sub-tabs (for active tab only)
function renderActiveSubTabs() {
  if (currentTab !== 'active') return '';
  
  const activeStudents = students.filter(s => s.status === 'アクティブ');
  const lessonCount = activeStudents.filter(s => s.contract_plan !== '永久会員' && s.contract_plan !== 'PROプラン').length;
  const proCount = activeStudents.filter(s => s.contract_plan === 'PROプラン').length;
  const permanentCount = activeStudents.filter(s => s.contract_plan === '永久会員').length;
  
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
  if (count === 3) return 'bg-yellow-100';
  return '';
}

// Get lesson count badge color
function getLessonCountBadgeColor(count) {
  if (count === 0) return 'bg-red-200 text-red-800';
  if (count === 1) return 'bg-yellow-200 text-yellow-800';
  if (count === 3) return 'bg-yellow-300 text-yellow-900';
  return 'bg-gray-200 text-gray-800';
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
    renderApp();
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
