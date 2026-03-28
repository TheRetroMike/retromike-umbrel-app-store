import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' }
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (username, password) => api.post('/auth/login', { username, password });
export const register = (data) => api.post('/auth/register', data);
export const getProfile = () => api.get('/auth/profile');
export const updateProfile = (data) => api.put('/auth/profile', data);
export const regenerateApiKey = () => api.post('/auth/regenerate-api-key');
export const getAddresses = () => api.get('/auth/addresses');
export const updateAddresses = (addresses) => api.put('/auth/addresses', { addresses });

// Pool
export const getPoolInfo = () => api.get('/pool/info');
export const getPoolStats = (coin) => api.get(`/pool/stats/${coin}`);
export const getPoolBlocks = (params) => api.get('/pool/blocks', { params });
export const getPoolHashrate = (coin, period) => api.get(`/pool/hashrate/${coin}`, { params: { period } });
export const getCoins = () => api.get('/pool/coins');
export const getAlgorithms = () => api.get('/pool/algorithms');
export const getDaemonStatus = () => api.get('/pool/daemon-status');
export const getMergeMiningInfo = () => api.get('/pool/merge-mining');

// Miner
export const getDashboard = () => api.get('/miner/dashboard');
export const getWorkers = (coin) => api.get('/miner/workers', { params: { coin } });
export const getMinerHashrate = (coin, period) => api.get('/miner/hashrate', { params: { coin, period } });
export const getPayments = (params) => api.get('/miner/payments', { params });
export const getBalances = () => api.get('/miner/balances');
export const getShares = (coin, period) => api.get('/miner/shares', { params: { coin, period } });
export const getEarnings = (coin) => api.get('/miner/earnings', { params: { coin } });

// Admin
export const getAdminDashboard = () => api.get('/admin/dashboard');
export const getAdminUsers = (params) => api.get('/admin/users', { params });
export const banUser = (id) => api.post(`/admin/users/${id}/ban`);
export const toggleAdmin = (id) => api.post(`/admin/users/${id}/toggle-admin`);
export const processPayments = () => api.post('/admin/payments/process');
export const getAdminSettings = () => api.get('/admin/settings');
export const updateAdminSettings = (data) => api.put('/admin/settings', data);
export const getAdminPayments = (params) => api.get('/admin/payments', { params });
export const getAdminCoins = () => api.get('/admin/coins');
export const updateAdminCoin = (coinId, data) => api.put(`/admin/coins/${coinId}`, data);

export default api;
