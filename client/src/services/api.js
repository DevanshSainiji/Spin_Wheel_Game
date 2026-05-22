const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function getHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

async function request(endpoint, options = {}, token = null) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: getHeaders(token),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data.data;
}

// Spin Wheel API
export const api = {
  // Get active wheel
  getActiveWheel: (token) => request('/spin-wheel/active', {}, token),

  // Get wheel by ID
  getWheel: (id, token) => request(`/spin-wheel/${id}`, {}, token),

  // Create wheel (admin)
  createWheel: (data, token) =>
    request('/spin-wheel', { method: 'POST', body: JSON.stringify(data) }, token),

  // Join wheel
  joinWheel: (id, token) =>
    request(`/spin-wheel/${id}/join`, { method: 'POST' }, token),

  // Start wheel (admin)
  startWheel: (id, token) =>
    request(`/spin-wheel/${id}/start`, { method: 'POST' }, token),

  // Get wheel history
  getHistory: (token) => request('/spin-wheel/history', {}, token),

  // Get transactions
  getTransactions: (token) => request('/spin-wheel/user/transactions', {}, token),

  // Get config (admin)
  getConfig: (token) => request('/spin-wheel/admin/config', {}, token),

  // Update config (admin)
  updateConfig: (key, value, token) =>
    request(`/spin-wheel/admin/config/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }, token),
};
