import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import crypto from 'crypto';

// チャート画像のキャッシュ（メモリキャッシュ）
const chartCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1時間

/**
 * キャッシュキーを生成
 */
function generateCacheKey(type, data) {
  const hash = crypto.createHash('md5').update(JSON.stringify({ type, data })).digest('hex');
  return `${type}_${hash}`;
}

/**
 * キャッシュから取得または生成
 */
async function getCachedOrGenerate(cacheKey, generateFn) {
  const cached = chartCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`📦 キャッシュヒット: ${cacheKey}`);
    return cached.buffer;
  }
  
  const buffer = await generateFn();
  chartCache.set(cacheKey, {
    buffer,
    timestamp: Date.now()
  });
  
  // キャッシュサイズ制限（最大50件）
  if (chartCache.size > 50) {
    const firstKey = chartCache.keys().next().value;
    chartCache.delete(firstKey);
  }
  
  return buffer;
}

/**
 * VQ診断のレーダーチャート画像を生成
 * @param {Object} data - チャートデータ
 * @param {number} data.snsAccuracy - SNS正解率
 * @param {number} data.streamingAccuracy - 配信正解率
 * @param {number} data.revenueAccuracy - 収益正解率
 * @returns {Promise<Buffer>} - PNG画像のバッファ
 */
export async function generateVQRadarChart(data) {
  const cacheKey = generateCacheKey('radar', data);
  
  return getCachedOrGenerate(cacheKey, async () => {
    const width = 500;  // サイズ削減: 600 → 500
    const height = 500;
  
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ 
    width, 
    height,
    backgroundColour: 'white'
  });
  
  const configuration = {
    type: 'radar',
    data: {
      labels: ['SNS', '配信', '収益'],
      datasets: [{
        label: '正解率',
        data: [
          data.snsAccuracy || 0,
          data.streamingAccuracy || 0,
          data.revenueAccuracy || 0
        ],
        backgroundColor: 'rgba(147, 51, 234, 0.2)',
        borderColor: 'rgba(147, 51, 234, 1)',
        borderWidth: 3,
        pointBackgroundColor: 'rgba(147, 51, 234, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(147, 51, 234, 1)',
        pointRadius: 6,
        pointHoverRadius: 8
      }]
    },
    options: {
      responsive: false,
      scales: {
        r: {
          beginAtZero: true,
          min: 0,
          max: 100,
          ticks: {
            stepSize: 20,
            callback: function(value) {
              return value + '%';
            },
            font: {
              size: 14
            }
          },
          pointLabels: {
            font: {
              size: 18,
              weight: 'bold'
            }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.1)'
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            font: {
              size: 16,
              weight: 'bold'
            }
          }
        },
        title: {
          display: true,
          text: 'VQ診断 正解率',
          font: {
            size: 20,
            weight: 'bold'
          },
          padding: {
            top: 10,
            bottom: 20
          }
        }
      }
    },
    plugins: [{
      id: 'background',
      beforeDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }]
  };
  
    try {
      const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
      console.log('✅ レーダーチャート生成成功');
      return imageBuffer;
    } catch (error) {
      console.error('❌ レーダーチャート生成エラー:', error);
      throw error;
    }
  });
}

/**
 * VQ診断のスコア推移グラフ画像を生成
 * @param {Array} historyData - 診断履歴データ（古い順）
 * @returns {Promise<Buffer>} - PNG画像のバッファ
 */
export async function generateVQTrendChart(historyData) {
  if (!historyData || historyData.length < 2) {
    return null; // 2件未満の場合は推移グラフなし
  }
  
  const cacheKey = generateCacheKey('trend', historyData);
  
  return getCachedOrGenerate(cacheKey, async () => {
    const width = 800;  // 横長
    const height = 500;
    
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ 
      width, 
      height,
      backgroundColour: 'white'
    });
    
    // 古い順にソート
    const sortedData = [...historyData].sort((a, b) => {
      return new Date(a.diagnosisDate) - new Date(b.diagnosisDate);
    });
    
    const configuration = {
      type: 'line',
      data: {
        labels: sortedData.map((h, i) => `${i + 1}回目\n${h.diagnosisDate || ''}`),
        datasets: [
          {
            label: 'SNS',
            data: sortedData.map(h => h.snsAccuracy || 0),
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderWidth: 3,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7
          },
          {
            label: '配信',
            data: sortedData.map(h => h.streamingAccuracy || 0),
            borderColor: 'rgb(16, 185, 129)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 3,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7
          },
          {
            label: '収益',
            data: sortedData.map(h => h.revenueAccuracy || 0),
            borderColor: 'rgb(245, 158, 11)',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            borderWidth: 3,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7
          }
        ]
      },
      options: {
        responsive: false,
        scales: {
          y: {
            beginAtZero: true,
            min: 0,
            max: 100,
            ticks: {
              stepSize: 20,
              callback: function(value) {
                return value + '%';
              },
              font: {
                size: 12
              }
            },
            title: {
              display: true,
              text: '正解率 (%)',
              font: {
                size: 14,
                weight: 'bold'
              }
            }
          },
          x: {
            title: {
              display: true,
              text: '診断回数',
              font: {
                size: 14,
                weight: 'bold'
              }
            },
            ticks: {
              font: {
                size: 11
              }
            }
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              font: {
                size: 14,
                weight: 'bold'
              },
              usePointStyle: true,
              padding: 15
            }
          },
          title: {
            display: true,
            text: `正解率の推移（全${sortedData.length}回）`,
            font: {
              size: 18,
              weight: 'bold'
            },
            padding: {
              top: 10,
              bottom: 20
            }
          }
        }
      },
      plugins: [{
        id: 'background',
        beforeDraw: (chart) => {
          const ctx = chart.ctx;
          ctx.save();
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, chart.width, chart.height);
          ctx.restore();
        }
      }]
    };
    
    try {
      const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
      console.log(`✅ 推移グラフ生成成功（${sortedData.length}件）`);
      return imageBuffer;
    } catch (error) {
      console.error('❌ 推移グラフ生成エラー:', error);
      throw error;
    }
  });
}
