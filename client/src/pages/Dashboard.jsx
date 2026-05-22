import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import './Dashboard.css';

export default function Dashboard({ onNavigate }) {
  const { user, token, logout, refreshUser } = useAuth();
  const [activeWheel, setActiveWheel] = useState(null);
  const [history, setHistory] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [activeTab, setActiveTab] = useState('wheel');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadData();
    const socket = getSocket();
    if (socket) {
      socket.on('wheel_created', () => loadActiveWheel());
      socket.on('participant_update', () => loadActiveWheel());
      socket.on('wheel_status_change', () => { loadActiveWheel(); loadHistory(); });
    }
    return () => {
      if (socket) {
        socket.off('wheel_created');
        socket.off('participant_update');
        socket.off('wheel_status_change');
      }
    };
  }, []);

  async function loadData() {
    await Promise.all([loadActiveWheel(), loadHistory(), loadTransactions()]);
  }

  async function loadActiveWheel() {
    try { const d = await api.getActiveWheel(token); setActiveWheel(d.spinWheel); } catch { setActiveWheel(null); }
  }
  async function loadHistory() {
    try { const d = await api.getHistory(token); setHistory(d.wheels || []); } catch {}
  }
  async function loadTransactions() {
    try { const d = await api.getTransactions(token); setTransactions(d.transactions || []); } catch {}
  }

  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const hasJoined = activeWheel?.participants?.some((p) => p.user.id === user?.id);
  const canStart = activeWheel?.createdById === user?.id && activeWheel?.status === 'WAITING' && (activeWheel?.participants?.length || 0) >= (activeWheel?.minParticipants || 3);

  async function handleJoin() {
    setJoining(true); setError('');
    try { await api.joinWheel(activeWheel.id, token); await loadActiveWheel(); await refreshUser(); }
    catch (e) { setError(e.message); }
    finally { setJoining(false); }
  }

  async function handleStart() {
    setStarting(true); setError('');
    try { await api.startWheel(activeWheel.id, token); await loadActiveWheel(); }
    catch (e) { setError(e.message); }
    finally { setStarting(false); }
  }

  const txTypeMap = { ENTRY_FEE: '🎫 Entry Fee', REFUND: '↩️ Refund', WINNER_PAYOUT: '🏆 Winner', ADMIN_PAYOUT: '👑 Admin', APP_FEE: '🏢 Platform' };

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-brand"><span className="dash-wheel-icon">🎡</span><h1>RoxStar</h1></div>
        <div className="dash-user-info">
          <div className="dash-coins"><span>🪙</span><span className="coin-amount">{user?.coins?.toLocaleString()}</span></div>
          {user?.role === 'ADMIN' && <span className="admin-badge">ADMIN</span>}
          <span className="username">@{user?.username}</span>
          <button onClick={logout} className="dash-logout">Logout</button>
        </div>
      </header>

      <main className="dash-main">
        <section className="active-wheel-section">
          {activeWheel ? (
            <div className="active-wheel-card">
              <div className="awc-glow"></div>
              <div className="awc-header"><h2>🎡 Active Spin Wheel</h2><span className={`status-badge ${activeWheel.status.toLowerCase()}`}>{activeWheel.status}</span></div>
              <div className="awc-stats">
                <div className="awc-stat"><span className="stat-label">Entry Fee</span><span className="stat-value">🪙 {activeWheel.entryFee}</span></div>
                <div className="awc-stat"><span className="stat-label">Players</span><span className="stat-value">{activeWheel.participants?.length || 0}</span></div>
                <div className="awc-stat"><span className="stat-label">Prize Pool</span><span className="stat-value prize">🪙 {Math.floor(activeWheel.winnerPoolAmount)}</span></div>
              </div>
              <div className="awc-participants"><h3>Participants</h3>
                <div className="participant-chips">
                  {activeWheel.participants?.map((p) => (<span key={p.id} className={`participant-chip ${p.user.id === user?.id ? 'me' : ''}`}>{p.user.username}</span>))}
                  {(!activeWheel.participants || activeWheel.participants.length === 0) && <span className="no-participants">No players yet</span>}
                </div>
              </div>
              {error && <div className="awc-error">{error}</div>}
              <div className="awc-actions">
                {activeWheel.status === 'WAITING' && !hasJoined && <button className="btn-join" onClick={handleJoin} disabled={joining}>{joining ? 'Joining...' : `Join (🪙 ${activeWheel.entryFee})`}</button>}
                {activeWheel.status === 'WAITING' && hasJoined && <button className="btn-joined" disabled>✅ Joined</button>}
                {canStart && <button className="btn-start" onClick={handleStart} disabled={starting}>{starting ? 'Starting...' : '🚀 Start Now'}</button>}
                {(activeWheel.status === 'ACTIVE' || hasJoined) && <button className="btn-view" onClick={() => onNavigate('game', activeWheel.id)}>👁️ View Game</button>}
              </div>
            </div>
          ) : (
            <div className="no-wheel-card">
              <div className="no-wheel-icon">🎡</div><h2>No Active Spin Wheel</h2><p>Wait for an admin to create one.</p>
              {user?.role === 'ADMIN' && <button className="btn-create" onClick={() => setShowCreateModal(true)}>+ Create Spin Wheel</button>}
            </div>
          )}
        </section>

        <div className="dash-tabs">
          <button className={`dash-tab ${activeTab === 'wheel' ? 'active' : ''}`} onClick={() => setActiveTab('wheel')}>🎯 History</button>
          <button className={`dash-tab ${activeTab === 'transactions' ? 'active' : ''}`} onClick={() => setActiveTab('transactions')}>💰 Transactions</button>
        </div>

        {activeTab === 'wheel' && <div className="history-grid">{history.length === 0 ? <p className="empty-state">No completed games yet</p> : history.map((w) => (
          <div key={w.id} className={`history-card ${w.status.toLowerCase()}`}><div className="history-card-header"><span className={`status-badge ${w.status.toLowerCase()}`}>{w.status}</span><span>🪙 {w.entryFee}</span></div>
            <div className="history-card-body"><p>Players: {w._count?.participants || 0}</p>{w.winner && <p>🏆 {w.winner.username}</p>}<p className="history-date">{new Date(w.createdAt).toLocaleDateString()}</p></div></div>
        ))}</div>}

        {activeTab === 'transactions' && <div className="transactions-list">{transactions.length === 0 ? <p className="empty-state">No transactions yet</p> : transactions.map((t) => (
          <div key={t.id} className={`transaction-row ${t.amount > 0 ? 'credit' : 'debit'}`}><div className="tx-info"><span className="tx-type">{txTypeMap[t.type] || t.type}</span><span className="tx-desc">{t.description}</span></div>
            <span className={`tx-amount ${t.amount > 0 ? 'credit' : 'debit'}`}>{t.amount > 0 ? '+' : ''}{t.amount}</span></div>
        ))}</div>}
      </main>

      {showCreateModal && <CreateWheelModal token={token} onClose={() => setShowCreateModal(false)} onCreated={() => { setShowCreateModal(false); loadActiveWheel(); }} />}
    </div>
  );
}

function CreateWheelModal({ token, onClose, onCreated }) {
  const [entryFee, setEntryFee] = useState(100);
  const [winnerPct, setWinnerPct] = useState(70);
  const [adminPct, setAdminPct] = useState(20);
  const [appPct, setAppPct] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const total = winnerPct + adminPct + appPct;

  async function handleCreate(e) {
    e.preventDefault();
    if (total !== 100) { setError('Must sum to 100'); return; }
    setLoading(true); setError('');
    try { await api.createWheel({ entryFee: Number(entryFee), winnerPoolPct: winnerPct, adminPoolPct: adminPct, appPoolPct: appPct }, token); onCreated(); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Create Spin Wheel</h2>
        <form onSubmit={handleCreate}>
          <div className="form-group"><label>Entry Fee</label><input type="number" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} min="10" required /></div>
          <div className="form-row">
            <div className="form-group"><label>Winner %</label><input type="number" value={winnerPct} onChange={(e) => setWinnerPct(Number(e.target.value))} /></div>
            <div className="form-group"><label>Admin %</label><input type="number" value={adminPct} onChange={(e) => setAdminPct(Number(e.target.value))} /></div>
            <div className="form-group"><label>App %</label><input type="number" value={appPct} onChange={(e) => setAppPct(Number(e.target.value))} /></div>
          </div>
          <p style={{ color: total === 100 ? 'var(--green)' : '#ef4444', fontSize: '0.85rem' }}>Total: {total}% {total === 100 ? '✓' : ''}</p>
          {error && <div className="auth-error">{error}</div>}
          <div className="modal-actions"><button type="button" className="btn-cancel" onClick={onClose}>Cancel</button><button type="submit" className="btn-create" disabled={loading}>{loading ? 'Creating...' : 'Create'}</button></div>
        </form>
      </div>
    </div>
  );
}
