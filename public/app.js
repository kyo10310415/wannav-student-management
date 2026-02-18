// API Base URL
const API_BASE = '';

// State
let students = [];
let tutors = [];
let lessonStats = {};
let currentMonth = new Date();
let selectedTutor = 'all';

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
    
    // Sync lessons for previous, current, and next month
    const now = new Date();
    const months = [
      { year: now.getFullYear(), month: now.getMonth() }, // Previous month
      { year: now.getFullYear(), month: now.getMonth() + 1 }, // Current month
      { year: now.getFullYear(), month: now.getMonth() + 2 }  // Next month
    ];
    
    for (const { year, month } of months) {
      const date = new Date(year, month - 1, 1);
      await axios.get(`${API_BASE}/api/lessons/sync/${date.getFullYear()}/${date.getMonth() + 1}`);
    }
    
    // Load data
    const [studentsRes, tutorsRes] = await Promise.all([
      axios.get(`${API_BASE}/api/students`),
      axios.get(`${API_BASE}/api/tutors`)
    ]);
    
    students = studentsRes.data.data;
    tutors = tutorsRes.data.data;
    
    // Load lesson stats for current month
    await loadLessonStats();
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

// Render main app
function renderApp() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  
  const content = document.getElementById('content');
  
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
          <select id="tutor-filter" onchange="filterByTutor(this.value)" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
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

    <!-- Statistics -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-chart-bar mr-2"></i>
        統計情報
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        ${renderStatistics()}
      </div>
    </div>

    <!-- Student List -->
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-list mr-2"></i>
        生徒一覧
      </h2>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">学籍番号</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">生徒名</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ステータス</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">契約プラン</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">キャラクター名</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">担任Tutor</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">今月の予約</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${renderStudentRows()}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Get tutor options for filter
function getTutorOptions() {
  const uniqueTutors = [...new Set(students.map(s => s.homeroom_tutor).filter(Boolean))];
  return uniqueTutors.map(tutor => 
    `<option value="${tutor}">${tutor}</option>`
  ).join('');
}

// Render statistics
function renderStatistics() {
  const filteredStudents = getFilteredStudents();
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
      <div class="text-3xl font-bold text-yellow-500">${threePlusLessons}</div>
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
        <td colspan="7" class="px-6 py-4 text-center text-gray-500">
          該当する生徒が見つかりません
        </td>
      </tr>
    `;
  }
  
  return filteredStudents.map(student => {
    const lessonCount = lessonStats[student.student_id] || 0;
    const colorClass = getLessonCountColor(lessonCount);
    
    return `
      <tr class="hover:bg-gray-50 ${colorClass}">
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${student.student_id || '-'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${student.name || '-'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${student.status || '-'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${student.contract_plan || '-'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${student.character_name || '-'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${student.homeroom_tutor || '-'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm font-bold">
          <span class="px-3 py-1 rounded-full ${getLessonCountBadgeColor(lessonCount)}">
            ${lessonCount}回
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

// Get filtered students
function getFilteredStudents() {
  if (selectedTutor === 'all') {
    return students;
  }
  return students.filter(s => s.homeroom_tutor === selectedTutor);
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
  
  // Sync lessons for the new month
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth() + 1;
  
  try {
    await axios.get(`${API_BASE}/api/lessons/sync/${year}/${month}`);
    await loadLessonStats();
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
