let displayedHistory = [];

    // 単独行を再送信
    async function resendSingleRow() {
      const rowNumber = parseInt(document.getElementById('singleRow').value);
      
      if (!rowNumber || rowNumber < 2) {
        showError('2以上の行番号を入力してください');
        return;
      }
      
      const statusDiv = document.getElementById('status');
      const resultDiv = document.getElementById('result');
      
      statusDiv.innerHTML = `
        <div class="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded-lg">
          <i class="fas fa-spinner fa-spin mr-2"></i>
          行 ${rowNumber} を再送信中...
        </div>
      `;
      resultDiv.innerHTML = '';
      
      try {
        const response = await fetch('/api/vq-diagnosis/resend-single-row', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ rowNumber })
        });
        
        const data = await response.json();
        
        if (data.success) {
          statusDiv.innerHTML = `
            <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg">
              <i class="fas fa-check-circle mr-2"></i>
              ${data.message}
            </div>
          `;
          
          resultDiv.innerHTML = `
            <div class="bg-white rounded-lg shadow-md p-6">
              <h3 class="text-lg font-semibold mb-3">送信完了</h3>
              <div class="space-y-2">
                <p><strong>行番号:</strong> ${data.data.rowNumber}</p>
                <p><strong>学籍番号:</strong> ${data.data.studentId}</p>
                <p><strong>生徒名:</strong> ${data.data.studentName}</p>
                <p><strong>診断タイプ:</strong> ${data.data.diagnosisType}</p>
              </div>
            </div>
          `;
        } else {
          showError(data.error || '再送信に失敗しました');
        }
        
      } catch (error) {
        console.error('再送信エラー:', error);
        showError('再送信中にエラーが発生しました: ' + error.message);
      }
    }

    // 範囲再送信
    async function resendFromRow() {
      const startRow = parseInt(document.getElementById('startRow').value);
      
      if (!startRow || startRow < 2) {
        showError('2以上の行番号を入力してください');
        return;
      }
      
      const statusDiv = document.getElementById('status');
      const resultDiv = document.getElementById('result');
      
      statusDiv.innerHTML = `
        <div class="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded-lg">
          <i class="fas fa-spinner fa-spin mr-2"></i>
          行 ${startRow} から再送信中...
        </div>
      `;
      resultDiv.innerHTML = '';
      
      try {
        const response = await fetch('/api/vq-diagnosis/resend-from-row', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ startRow })
        });
        
        const data = await response.json();
        
        if (data.success) {
          statusDiv.innerHTML = `
            <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg">
              <i class="fas fa-check-circle mr-2"></i>
              ${data.message}
            </div>
          `;
          
          resultDiv.innerHTML = `
            <div class="bg-white rounded-lg shadow-md p-6">
              <h3 class="text-lg font-semibold mb-3">実行結果</h3>
              <div class="space-y-2">
                <p><strong>処理件数:</strong> ${data.data?.processed || 0}件</p>
                <p><strong>エラー件数:</strong> ${data.data?.errors || 0}件</p>
              </div>
              
              <div class="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
                <p class="text-sm text-yellow-800">
                  <i class="fas fa-info-circle mr-1"></i>
                  送信成功した行はスプレッドシートのR列に「完了」が記録されます
                </p>
              </div>
            </div>
          `;
        } else {
          showError(data.error || '再送信に失敗しました');
        }
        
      } catch (error) {
        console.error('再送信エラー:', error);
        showError('再送信中にエラーが発生しました: ' + error.message);
      }
    }

    // 履歴を読み込み
    async function loadHistory() {
      const studentId = document.getElementById('searchStudentId').value.trim();
      const historyList = document.getElementById('historyList');
      
      displayedHistory = [];
      historyList.innerHTML = `
        <div class="text-center text-gray-500 py-4">
          <i class="fas fa-spinner fa-spin mr-2"></i>
          読み込み中...
        </div>
      `;
      
      try {
        let url = '/api/vq-diagnosis/history?limit=50';
        if (studentId) {
          url += `&student_id=${encodeURIComponent(studentId)}`;
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success && data.history.length > 0) {
          displayedHistory = data.history;
          historyList.innerHTML = `
            <div class="space-y-2 max-h-96 overflow-y-auto">
              ${data.history.map((h, index) => `
                <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <div class="flex-1">
                    <p class="font-medium">${h.student_name_current || h.student_name || '不明'}</p>
                    <p class="text-sm text-gray-600">${h.diagnosis_type || '不明'} | 行 ${h.sheet_row_number || '?'}</p>
                    <p class="text-xs text-gray-500">${new Date(h.sent_at).toLocaleString('ja-JP')}</p>
                  </div>
                  <button 
                    data-history-index="${index}"
                    class="ml-4 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors text-sm"
                  >
                    <i class="fas fa-trash mr-1"></i>
                    削除
                  </button>
                </div>
              `).join('')}
            </div>
          `;
        } else {
          historyList.innerHTML = `
            <div class="text-center text-gray-500 py-4">
              <i class="fas fa-inbox mr-2"></i>
              履歴がありません
            </div>
          `;
        }
        
      } catch (error) {
        console.error('履歴読み込みエラー:', error);
        historyList.innerHTML = `
          <div class="text-center text-red-500 py-4">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            エラーが発生しました
          </div>
        `;
      }
    }

    // 履歴を削除
    async function deleteHistory(id, studentName) {
      if (!confirm(`${studentName} の履歴を削除しますか？`)) {
        return;
      }
      
      try {
        const response = await fetch(`/api/vq-diagnosis/history/${id}`, {
          method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
          showSuccess(`履歴を削除しました: ${studentName}`);
          loadHistory(); // 再読み込み
        } else {
          showError(data.error || '削除に失敗しました');
        }
        
      } catch (error) {
        console.error('削除エラー:', error);
        showError('削除中にエラーが発生しました: ' + error.message);
      }
    }
    
    function showError(message) {
      const statusDiv = document.getElementById('status');
      statusDiv.innerHTML = `
        <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg">
          <i class="fas fa-exclamation-triangle mr-2"></i>
          ${message}
        </div>
      `;
      setTimeout(() => { statusDiv.innerHTML = ''; }, 5000);
    }

    function showSuccess(message) {
      const statusDiv = document.getElementById('status');
      statusDiv.innerHTML = `
        <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg">
          <i class="fas fa-check-circle mr-2"></i>
          ${message}
        </div>
      `;
      setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
    }

document.getElementById('resendSingleRowBtn').addEventListener('click', resendSingleRow);
document.getElementById('resendFromRowBtn').addEventListener('click', resendFromRow);
document.getElementById('loadHistoryBtn').addEventListener('click', loadHistory);
document.getElementById('historyList').addEventListener('click', event => {
  const button = event.target.closest('button[data-history-index]');
  if (!button || !event.currentTarget.contains(button)) return;
  const index = Number(button.dataset.historyIndex);
  if (!Number.isInteger(index) || index < 0) return;
  const history = displayedHistory[index];
  if (!history) return;
  return deleteHistory(history.id, history.student_name_current || history.student_name || '不明');
});
