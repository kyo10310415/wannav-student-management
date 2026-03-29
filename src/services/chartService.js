import { ChartJSNodeCanvas } from 'chartjs-node-canvas';

/**
 * VQ診断のレーダーチャート画像を生成
 * @param {Object} data - チャートデータ
 * @param {number} data.snsAccuracy - SNS正解率
 * @param {number} data.streamingAccuracy - 配信正解率
 * @param {number} data.revenueAccuracy - 収益正解率
 * @returns {Promise<Buffer>} - PNG画像のバッファ
 */
export async function generateVQRadarChart(data) {
  const width = 600;
  const height = 600;
  
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
}
