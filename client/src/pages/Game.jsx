import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { getSocket, joinWheelRoom, leaveWheelRoom } from '../services/socket';
import './Game.css';

export default function Game({ wheelId, onBack }) {
  const { user, token, refreshUser } = useAuth();
  const [wheel, setWheel] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [eliminated, setEliminated] = useState([]);
  const [winner, setWinner] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [lastEliminated, setLastEliminated] = useState(null);
  const [payouts, setPayouts] = useState(null);
  const [gameLog, setGameLog] = useState([]);
  const logRef = useRef(null);

  useEffect(() => {
    loadWheel();
    joinWheelRoom(wheelId);
    const socket = getSocket();
    if (socket) {
      socket.on('user_joined', handleUserJoined);
      socket.on('countdown_tick', handleCountdown);
      socket.on('wheel_started', handleWheelStarted);
      socket.on('user_eliminated', handleElimination);
      socket.on('wheel_completed', handleCompleted);
      socket.on('wheel_aborted', handleAborted);
    }
    return () => {
      leaveWheelRoom(wheelId);
      if (socket) {
        socket.off('user_joined'); socket.off('countdown_tick');
        socket.off('wheel_started'); socket.off('user_eliminated');
        socket.off('wheel_completed'); socket.off('wheel_aborted');
      }
    };
  }, [wheelId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [gameLog]);

  async function loadWheel() {
    try {
      const d = await api.getWheel(wheelId, token);
      const w = d.spinWheel;
      setWheel(w);
      const active = [];
      const elim = [];
      w.participants.forEach(p => {
        if (p.eliminatedAt) elim.push(p);
        else active.push(p);
      });
      setParticipants(active);
      setEliminated(elim.sort((a, b) => (a.eliminationOrder || 0) - (b.eliminationOrder || 0)));
      if (w.winner) setWinner(w.winner);
    } catch {}
  }

  function addLog(msg) {
    setGameLog(prev => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
  }

  function handleUserJoined(data) {
    addLog(`${data.user.username} joined the game!`);
    loadWheel();
  }

  function handleCountdown(data) {
    setCountdown(data.secondsRemaining);
  }

  function handleWheelStarted(data) {
    addLog('🎡 Wheel is spinning! Eliminations begin...');
    setCountdown(null);
    setWheel(prev => prev ? { ...prev, status: 'ACTIVE' } : prev);
  }

  function handleElimination(data) {
    setLastEliminated(data);
    addLog(`❌ ${data.username} eliminated! (${data.remaining} remaining)`);
    setParticipants(prev => prev.filter(p => p.user.id !== data.userId));
    setEliminated(prev => [...prev, { user: { id: data.userId, username: data.username }, eliminationOrder: data.eliminationOrder }]);
    setTimeout(() => setLastEliminated(null), 3000);
  }

  function handleCompleted(data) {
    setWinner(data.winner);
    setPayouts(data.payouts);
    setWheel(prev => prev ? { ...prev, status: 'COMPLETED' } : prev);
    addLog(`🏆 ${data.winner.username} WINS! Payout: 🪙 ${data.payouts.winnerPayout}`);
    refreshUser();
  }

  function handleAborted(data) {
    setWheel(prev => prev ? { ...prev, status: 'ABORTED' } : prev);
    addLog(`⛔ Game aborted: ${data.reason}`);
    refreshUser();
  }

  if (!wheel) return <div className="game-loading"><div className="spinner-lg"></div></div>;

  const isActive = wheel.status === 'ACTIVE';
  const isCompleted = wheel.status === 'COMPLETED';
  const isAborted = wheel.status === 'ABORTED';
  const isMe = (id) => id === user?.id;

  return (
    <div className="game-page">
      <header className="game-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <h1>🎡 Spin Wheel Arena</h1>
        <div className="dash-coins"><span>🪙</span><span className="coin-amount">{user?.coins?.toLocaleString()}</span></div>
      </header>

      <div className="game-layout">
        <div className="game-center">
          {/* Wheel Visualization */}
          <div className={`wheel-container ${isActive ? 'spinning' : ''} ${isCompleted ? 'done' : ''}`}>
            <div className="wheel-ring">
              {participants.map((p, i) => {
                const angle = (360 / Math.max(participants.length, 1)) * i;
                const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f97316', '#14b8a6'];
                return (
                  <div key={p.id} className={`wheel-segment ${isMe(p.user.id) ? 'me' : ''}`} style={{ '--angle': `${angle}deg`, '--color': colors[i % colors.length] }}>
                    <span className="segment-name">{p.user.username}</span>
                  </div>
                );
              })}
            </div>
            <div className="wheel-center-circle">
              {wheel.status === 'WAITING' && <span>{countdown != null ? `${countdown}s` : 'WAITING'}</span>}
              {isActive && <span className="active-text">LIVE</span>}
              {isCompleted && <span>🏆</span>}
              {isAborted && <span>⛔</span>}
            </div>
          </div>

          {/* Elimination Flash */}
          {lastEliminated && (
            <div className="elimination-flash">
              <span className="flash-x">✖</span>
              <span className="flash-name">{lastEliminated.username}</span>
              <span className="flash-text">ELIMINATED</span>
            </div>
          )}

          {/* Winner Banner */}
          {winner && (
            <div className="winner-banner">
              <div className="winner-confetti">🎉</div>
              <h2>🏆 {winner.username} WINS!</h2>
              {payouts && (
                <div className="payout-details">
                  <div className="payout-item"><span>Winner Prize</span><span className="payout-amount">🪙 {payouts.winnerPayout}</span></div>
                  <div className="payout-item"><span>Admin Commission</span><span className="payout-amount">🪙 {payouts.adminPayout}</span></div>
                  <div className="payout-item dim"><span>Platform Fee</span><span>🪙 {payouts.appFee}</span></div>
                </div>
              )}
              {isMe(winner.userId) && <div className="winner-me">That&apos;s YOU! 🎊</div>}
            </div>
          )}
        </div>

        <div className="game-sidebar">
          {/* Stats */}
          <div className="sidebar-card">
            <h3>Game Info</h3>
            <div className="info-row"><span>Status</span><span className={`status-badge ${wheel.status.toLowerCase()}`}>{wheel.status}</span></div>
            <div className="info-row"><span>Entry Fee</span><span>🪙 {wheel.entryFee}</span></div>
            <div className="info-row"><span>Prize Pool</span><span className="prize-text">🪙 {Math.floor(wheel.winnerPoolAmount)}</span></div>
            <div className="info-row"><span>Remaining</span><span>{participants.length}</span></div>
          </div>

          {/* Participants */}
          <div className="sidebar-card">
            <h3>🟢 Active ({participants.length})</h3>
            <div className="player-list">
              {participants.map(p => (
                <div key={p.id} className={`player-item active ${isMe(p.user.id) ? 'me' : ''}`}>
                  <span className="player-dot green"></span>
                  <span>{p.user.username} {isMe(p.user.id) ? '(You)' : ''}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Eliminated */}
          {eliminated.length > 0 && (
            <div className="sidebar-card">
              <h3>❌ Eliminated ({eliminated.length})</h3>
              <div className="player-list">
                {eliminated.map((p, i) => (
                  <div key={i} className="player-item eliminated">
                    <span className="player-dot red"></span>
                    <span>{p.user.username}</span>
                    <span className="elim-order">#{p.eliminationOrder}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Game Log */}
          <div className="sidebar-card log-card">
            <h3>📋 Game Log</h3>
            <div className="game-log" ref={logRef}>
              {gameLog.map((l, i) => (
                <div key={i} className="log-entry"><span className="log-time">{l.time}</span><span>{l.msg}</span></div>
              ))}
              {gameLog.length === 0 && <p className="log-empty">Waiting for events...</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
