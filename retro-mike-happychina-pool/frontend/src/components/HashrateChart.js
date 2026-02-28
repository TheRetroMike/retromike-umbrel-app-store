import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

function HashrateChart({ data, label = 'Hashrate', color = '#00d4ff', height = 250 }) {
  if (!data || data.length === 0) {
    return <div className="empty-state"><p>No hashrate data available</p></div>;
  }

  const chartData = {
    labels: data.map(d => {
      const date = new Date(d.created_at);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }),
    datasets: [
      {
        label,
        data: data.map(d => d.hashrate),
        borderColor: color,
        backgroundColor: color + '20',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1a2e',
        titleColor: '#e0e0e0',
        bodyColor: '#8892b0',
        borderColor: '#2a2a4a',
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: function (context) {
            let value = context.parsed.y;
            const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
            let unitIndex = 0;
            while (value >= 1000 && unitIndex < units.length - 1) {
              value /= 1000;
              unitIndex++;
            }
            return `${value.toFixed(2)} ${units[unitIndex]}`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { color: '#1a1a3e', drawBorder: false },
        ticks: { color: '#5a6380', maxTicksLimit: 8, font: { size: 11 } }
      },
      y: {
        grid: { color: '#1a1a3e', drawBorder: false },
        ticks: {
          color: '#5a6380',
          font: { size: 11 },
          callback: function (value) {
            const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
            let unitIndex = 0;
            let v = value;
            while (v >= 1000 && unitIndex < units.length - 1) {
              v /= 1000;
              unitIndex++;
            }
            return `${v.toFixed(1)} ${units[unitIndex]}`;
          }
        }
      }
    }
  };

  return (
    <div style={{ height }}>
      <Line data={chartData} options={options} />
    </div>
  );
}

export default HashrateChart;
