import React, { useState, useEffect } from 'react';
import { Zap, RefreshCw, ChevronUp } from 'lucide-react';
import './index.css';

function App() {
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'System initialized. Your physiological telemetry is synced. How shall we optimize your performance today?' }
  ]);
  const [isLoading, setIsLoading] = useState(false);

  // Dynamic state populated from Garmin MCP
  const [profile, setProfile] = useState({
    displayName: 'Jamal Sterling',
    level: 14
  });
  const [metrics, setMetrics] = useState({
    distance: '0.0',
    pace: '0:00',
    target: '45',
    vo2max: '52.4'
  });
  const [recentActivities, setRecentActivities] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Sync Garmin stats from backend
  const syncGarmin = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('http://localhost:3001/api/stats');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      if (data) {
        setMetrics({
          distance: data.distance || '0.0',
          pace: data.pace || '0:00',
          target: data.target || '45',
          vo2max: data.vo2max || '52.4'
        });
        setProfile(prev => ({
          ...prev,
          displayName: data.displayName || prev.displayName
        }));
        setRecentActivities(data.recentActivities || []);
        
        // Add a message from system confirming sync
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: `Sync completed. Telemetry updated. Active VO2 Max running standard: ${data.vo2max || '52.4'}. Today's distance: ${data.distance || '0.0'} km.` }
        ]);
      }
    } catch (err) {
      console.error('Failed to sync Garmin stats:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    syncGarmin();
  }, []);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isLoading) return;

    const userMessage = chatInput.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatInput('');
    setIsLoading(true);

    try {
      const res = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: data.response,
        actions: data.actions || []
      }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error connecting to the coaching server.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePromptClick = (prompt) => {
    setChatInput(prompt);
  };

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <header className="topbar">
        <div className="logo-section">
          <div className="logo-icon">
            <Zap size={24} fill="currentColor" />
          </div>
          <span>STRIDE.AI</span>
        </div>
        
        <div className="user-section">
          <div className="flex-col" style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '1px' }}>LEVEL 14</div>
            <div style={{ fontWeight: 700 }}>{profile.displayName}</div>
          </div>
          <div className="user-avatar">
            <div style={{ width: '100%', height: '100%', backgroundColor: '#444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '1.5rem' }}>🧑🏽</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        
        {/* Left Sidebar (Coach KAI) */}
        <aside className="sidebar">
          <div className="coach-header">
            <div className="coach-avatar">
              <span style={{ fontSize: '2rem' }}>🧠</span>
            </div>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>Coach KAI</div>
              <div className="status-indicator">
                <div className="status-dot"></div>
                ONLINE
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} className="chat-history">
            {messages.map((msg, idx) => (
              <div key={idx} className="chat-bubble" style={{ 
                backgroundColor: msg.role === 'user' ? 'var(--neon-yellow)' : '#2a2a2a',
                color: msg.role === 'user' ? '#000' : '#e0e0e0',
                borderBottomRightRadius: msg.role === 'user' ? '4px' : '24px',
                borderBottomLeftRadius: msg.role === 'user' ? '24px' : '4px',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '90%'
              }}>
                <div>{msg.content}</div>
                {msg.actions && msg.actions.length > 0 && (
                  <div className="chat-actions-container">
                    {msg.actions.map((action, aIdx) => (
                      <div key={aIdx} className="chat-action-tag">
                        <span className="action-dot"></span>
                        <span>{action}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="chat-bubble" style={{ alignSelf: 'flex-start', maxWidth: '90%' }}>
                <span className="text-muted">Coach is thinking...</span>
              </div>
            )}
          </div>

          <div className="suggested-prompts">
            <button className="prompt-pill" onClick={() => handlePromptClick('Analyze my last run')}>Analyze my last run</button>
            <button className="prompt-pill" onClick={() => handlePromptClick('Give me a marathon tip')}>Give me a marathon tip</button>
            <button className="prompt-pill" onClick={() => handlePromptClick('Should I take a rest day?')}>Should I take a rest day?</button>
          </div>

          <form className="chat-input-wrapper" onSubmit={sendMessage}>
            <input 
              type="text" 
              className="chat-input" 
              placeholder="Message your coach..." 
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={isLoading}
            />
            <button type="submit" className="send-btn" disabled={isLoading}>
              <ChevronUp size={24} strokeWidth={3} />
            </button>
          </form>
        </aside>

        {/* Right Dashboard Area */}
        <section className="dashboard">
          
          <div className="dash-header">
            <div className="dash-nav">
              <div className="dash-tab active">DASHBOARD</div>
              <div className="dash-tab">PLAN</div>
              <div className="dash-tab">ACTIVITY</div>
            </div>
            
            <div className="header-actions">
              <button 
                className="btn btn-outline" 
                onClick={syncGarmin} 
                disabled={isSyncing}
              >
                <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'SYNCING...' : 'SYNC GARMIN'}
              </button>
              <button className="btn btn-white">
                LOG RECENT SESSION
              </button>
            </div>
          </div>

          <div className="metrics-grid">
            {/* Metric 1 */}
            <div className="metric-card bg-neon-yellow shadow-glow-yellow">
              <div className="metric-label">TOTAL DISTANCE</div>
              <div className="metric-value outfit">{metrics.distance}</div>
              <div className="metric-sub">KILOMETERS REACHED</div>
            </div>
            
            {/* Metric 2 */}
            <div className="metric-card bg-white">
              <div className="metric-label" style={{ color: 'var(--text-muted)' }}>AVERAGE PACE</div>
              <div className="metric-value outfit">{metrics.pace}</div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: '60%' }}></div>
              </div>
            </div>

            {/* Metric 3 */}
            <div className="metric-card bg-neon-cyan shadow-glow-cyan">
              <div className="metric-label">NEXT TARGET</div>
              <div className="metric-value outfit">{metrics.target}</div>
              <div className="metric-sub">MIN // AEROBIC BASE</div>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <div className="chart-title">HEART RATE PROGRESSION</div>
              <div className="chart-sub">VO2 MAX TREND: {metrics.vo2max} (OPTIMAL CAPACITY)</div>
            </div>
            
            <div className="bars-container">
              <div className="bar" style={{ height: '30%' }}></div>
              <div className="bar" style={{ height: '50%' }}></div>
              <div className="bar" style={{ height: '20%' }}></div>
              <div className="bar" style={{ height: '60%' }}></div>
              <div className="bar highlight" style={{ height: '90%' }}></div>
              <div className="bar" style={{ height: '40%' }}></div>
              <div className="bar" style={{ height: '15%' }}></div>
            </div>
          </div>

          {/* Recent Activities Section */}
          {recentActivities.length > 0 && (
            <div className="chart-card">
              <div className="chart-header" style={{ marginBottom: '1.5rem' }}>
                <div className="chart-title">RECENT SESSIONS</div>
                <div className="chart-sub">LATEST SYNCHRONIZED ACTIVITIES</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {recentActivities.map(act => (
                  <div key={act.id} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    padding: '1.25rem', 
                    backgroundColor: 'rgba(255,255,255,0.02)', 
                    borderRadius: '16px',
                    border: '1px solid var(--panel-border)'
                  }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '0.5px' }}>{act.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>
                        {act.startTime} // {act.type.replace('_', ' ')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, color: 'var(--neon-cyan)', fontSize: '1.25rem' }} className="outfit">
                        {act.distance} <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>KM</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', fontWeight: 600 }}>
                        {act.duration} MIN // {act.avgHr ? `AVG ${act.avgHr} BPM` : 'NO HR DATA'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="phase-card">
            <div>
              <div className="phase-label">CURRENT TRAINING PHASE</div>
              <div className="phase-title">BASE BUILDING II</div>
            </div>
            <button className="btn btn-white btn-large">
              INITIATE SESSION
            </button>
          </div>

        </section>
      </main>
    </div>
  );
}

export default App;
