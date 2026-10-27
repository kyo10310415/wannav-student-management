    async function testDiscordWebhook() {
      const studentId = document.getElementById('studentId').value.trim();
      
      if (!studentId) {
        showError('学籍番号を入力してください');
        return;
      }
      
      const statusDiv = document.getElementById('status');
      const resultDiv = document.getElementById('result');
      
      statusDiv.innerHTML = `
        <div class="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded-lg">
          <i class="fas fa-spinner fa-spin mr-2"></i>
          テストメッセージを送信中...
        </div>
      `;
      resultDiv.innerHTML = '';
      
      try {
        const response = await fetch('/api/survey/test-discord-webhook', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ studentId })
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
              <h3 class="text-lg font-semibold mb-3">
                <i class="fas fa-info-circle mr-2 text-blue-600"></i>
                送信結果
              </h3>
              
              <div class="space-y-3">
                <div class="p-3 bg-green-50 border border-green-200 rounded">
                  <div class="font-semibold text-green-800">Discord APIステータス</div>
                  <div class="text-green-700">${data.discordStatus}</div>
                </div>
                
                <div class="p-3 bg-gray-50 border border-gray-200 rounded">
                  <div class="font-semibold text-gray-800">Discord APIレスポンス</div>
                  <pre class="text-xs text-gray-700 mt-2 overflow-x-auto">${JSON.stringify(data.discordData, null, 2)}</pre>
                </div>
              </div>
              
              <div class="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
                <p class="text-sm text-blue-800">
                  <i class="fas fa-info-circle mr-1"></i>
                  <strong>確認:</strong> Discordで「Discord Webhook テスト」というメッセージが届いているか確認してください。
                </p>
              </div>
            </div>
          `;
        } else {
          showError(data.error || 'テスト送信に失敗しました', data.discordError);
        }
        
      } catch (error) {
        console.error('テスト送信エラー:', error);
        showError('テスト送信中にエラーが発生しました: ' + error.message);
      }
    }
    
    function showError(message, discordError) {
      const statusDiv = document.getElementById('status');
      const resultDiv = document.getElementById('result');
      
      statusDiv.innerHTML = `
        <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg">
          <i class="fas fa-exclamation-triangle mr-2"></i>
          ${message}
        </div>
      `;
      
      if (discordError) {
        resultDiv.innerHTML = `
          <div class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-lg font-semibold mb-3 text-red-600">
              <i class="fas fa-bug mr-2"></i>
              Discord APIエラー
            </h3>
            <pre class="text-xs text-red-700 bg-red-50 p-3 rounded overflow-x-auto">${JSON.stringify(discordError, null, 2)}</pre>
          </div>
        `;
      }
    }

document.getElementById('testDiscordButton').addEventListener('click', testDiscordWebhook);
