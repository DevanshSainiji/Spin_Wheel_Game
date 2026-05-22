import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { connectSocket, disconnectSocket } from './services/socket';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Game from './pages/Game';

function MainApp() {
  const { user, token, loading } = useAuth();
  const [currentPage, setCurrentPage] = useState('dashboard'); // dashboard, game
  const [selectedWheelId, setSelectedWheelId] = useState(null);

  useEffect(() => {
    if (token) {
      connectSocket(token);
    } else {
      disconnectSocket();
    }
    return () => {
      disconnectSocket();
    };
  }, [token]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        height: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#09090b',
        color: '#f4f4f5',
        fontSize: '1.2rem',
        fontFamily: 'sans-serif'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '4px solid rgba(255,255,255,0.1)',
          borderTopColor: '#6366f1',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          marginBottom: '1rem'
        }}></div>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  function handleNavigate(page, wheelId = null) {
    setCurrentPage(page);
    if (wheelId) {
      setSelectedWheelId(wheelId);
    }
  }

  return (
    <>
      {currentPage === 'dashboard' && (
        <Dashboard onNavigate={handleNavigate} />
      )}
      {currentPage === 'game' && selectedWheelId && (
        <Game wheelId={selectedWheelId} onBack={() => handleNavigate('dashboard')} />
      )}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
