export function formatHashrate(hashrate) {
  if (!hashrate || hashrate === 0) return '0 H/s';

  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
  let unitIndex = 0;
  let value = hashrate;

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

export function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined) return '0';
  if (typeof num === 'string') num = parseFloat(num);
  if (isNaN(num)) return '0';

  if (num >= 1e9) return (num / 1e9).toFixed(decimals) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(decimals) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(decimals) + 'K';

  return num.toFixed(decimals);
}

export function formatCoin(amount, symbol, decimals = 8) {
  if (!amount) return `0 ${symbol || ''}`;
  return `${parseFloat(amount).toFixed(decimals)} ${symbol || ''}`;
}

export function formatDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

export function formatTimeAgo(date) {
  if (!date) return 'Never';
  // SQLite CURRENT_TIMESTAMP returns UTC without 'Z' suffix - append it so JS parses as UTC
  const dateStr = typeof date === 'string' && !date.endsWith('Z') ? date + 'Z' : date;
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function shortenHash(hash, chars = 8) {
  if (!hash) return '';
  if (hash.length <= chars * 2) return hash;
  return `${hash.substring(0, chars)}...${hash.substring(hash.length - chars)}`;
}

export function getStatusColor(status) {
  switch (status) {
    case 'confirmed': return 'var(--green)';
    case 'pending': return 'var(--orange)';
    case 'orphaned':
    case 'failed': return 'var(--red)';
    case 'completed': return 'var(--green)';
    default: return 'var(--text-secondary)';
  }
}
