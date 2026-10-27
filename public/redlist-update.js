        async function updateRedList() {
            const btn = document.getElementById('updateBtn');
            const status = document.getElementById('status');
            const result = document.getElementById('result');
            
            btn.disabled = true;
            btn.textContent = '処理中...';
            status.classList.remove('hidden');
            result.classList.add('hidden');
            
            try {
                const response = await fetch('/api/red-list/update', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({})
                });
                
                const data = await response.json();
                
                status.classList.add('hidden');
                result.classList.remove('hidden');
                
                if (data.success) {
                    result.innerHTML = `
                        <div class="bg-green-50 border-l-4 border-green-500 p-4">
                            <p class="text-green-700 font-bold">✅ 更新完了！</p>
                            <p class="text-green-600 text-sm mt-2">
                                ${data.data.updated} 名の生徒を更新しました<br>
                                ${data.data.errors > 0 ? `エラー: ${data.data.errors} 件` : ''}
                            </p>
                            <p class="text-sm text-green-600 mt-3">
                                生徒管理ページをリロードして確認してください。
                            </p>
                        </div>
                    `;
                } else {
                    result.innerHTML = `
                        <div class="bg-red-50 border-l-4 border-red-500 p-4">
                            <p class="text-red-700 font-bold">❌ エラー</p>
                            <p class="text-red-600 text-sm">${data.error || '不明なエラー'}</p>
                        </div>
                    `;
                }
            } catch (error) {
                status.classList.add('hidden');
                result.classList.remove('hidden');
                result.innerHTML = `
                    <div class="bg-red-50 border-l-4 border-red-500 p-4">
                        <p class="text-red-700 font-bold">❌ エラー</p>
                        <p class="text-red-600 text-sm">${error.message}</p>
                    </div>
                `;
            } finally {
                btn.disabled = false;
                btn.textContent = '再計算を実行';
            }
        }

document.getElementById('updateBtn').addEventListener('click', updateRedList);
