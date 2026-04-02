import { useState, useEffect, useRef } from 'react';
import './App.css';
import type { AppConfig, Session, Message } from './types';
import { callGeminiStream } from './api';

const DEFAULT_CONFIG: AppConfig = {
  apiKey: '',
  projectId: 'civic-depth-419702',
  location: 'us-central1',
  modelId: 'gemini-3.1-pro-preview',
  systemPrompt: '测试',
  safetyLevel: 0, // 0: OFF (Block None)
  temperature: 1,
  topP: 0.95,
  maxOutputTokens: 65535,
  thinkingLevel: 'LOW'
};

// 提取一个无控制状态的输入框组件，应对数万字输入不卡顿
function ChatInput({ onSend, disabled }: { onSend: (text: string) => void, disabled: boolean }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const val = inputRef.current?.value || '';
    if (val.trim()) {
      onSend(val);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="chat-input-container">
      <textarea 
        className="chat-input"
        ref={inputRef}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder="输入您的问题... (Shift+Enter 换行，支持数十万字超长文本无卡顿)"
        disabled={disabled}
      />
      <button 
        className="btn-send" 
        onClick={handleSend}
        disabled={disabled}
      >
        发送
      </button>
    </div>
  );
}

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('gemini_theme') as 'dark' | 'light') || 'dark';
  });

  const [config, setConfig] = useState<AppConfig>(() => {
    const saved = localStorage.getItem('gemini_config');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });

  const [sessions, setSessions] = useState<Session[]>(() => {
    const saved = localStorage.getItem('gemini_sessions');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // UI state
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gemini_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('gemini_config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem('gemini_sessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const createSession = () => {
    const newSession: Session = {
      id: Date.now().toString(),
      name: `新对话 ${sessions.length + 1}`,
      messages: [],
      updatedAt: Date.now()
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('确定要删除这个对话吗？')) {
      const updatedSessions = sessions.filter(s => s.id !== id);
      setSessions(updatedSessions);
      if (activeSessionId === id) {
        setActiveSessionId(updatedSessions.length > 0 ? updatedSessions[0].id : null);
      }
    }
  };

  useEffect(() => {
    if (sessions.length === 0) {
      createSession();
    } else if (!activeSessionId) {
      setActiveSessionId(sessions[0].id);
    }
  }, []);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const handleSend = async (inputText: string) => {
    if (!activeSession) return;
    
    if (!config.apiKey || !config.projectId || !config.modelId) {
      alert("请先在右侧设置中配置 API Key、项目 ID 和模型 ID。");
      return;
    }

    const userMessage: Message = { role: 'user', parts: [{ text: inputText }] };
    const modelMessage: Message = { role: 'model', parts: [{ text: '' }] };
    
    const updatedSessions = sessions.map(s => {
      if (s.id === activeSessionId) {
        return {
          ...s,
          messages: [...s.messages, userMessage, modelMessage],
          updatedAt: Date.now(),
          // Auto-name session based on first message
          name: s.messages.length === 0 ? inputText.substring(0, 20) + (inputText.length > 20 ? '...' : '') : s.name
        };
      }
      return s;
    });

    setSessions(updatedSessions);
    setIsLoading(true);

    try {
      const currentSession = updatedSessions.find(s => s.id === activeSessionId)!;
      // 去掉最后那条空的 AI 占位消息，作为历史发送给接口
      const historyToSend = currentSession.messages.slice(0, -1);

      await callGeminiStream(historyToSend, config, (chunkText: string) => {
        setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
            const newMessages = [...s.messages];
            newMessages[newMessages.length - 1] = { role: 'model', parts: [{ text: chunkText }] };
            return { ...s, messages: newMessages, updatedAt: Date.now() };
          }
          return s;
        }));
      });
      
    } catch (error: any) {
      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          const newMessages = [...s.messages];
          newMessages[newMessages.length - 1] = { role: 'model', parts: [{ text: `[错误]: ${error.message}` }] };
          return { ...s, messages: newMessages, updatedAt: Date.now() };
        }
        return s;
      }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Left Sidebar - History */}
      <div className="sidebar-left">
        <div className="sidebar-header">
          历史对话
          <button className="btn-theme-toggle" onClick={toggleTheme} title="切换主题">
            {theme === 'dark' ? '☀️ 亮色' : '🌙 暗色'}
          </button>
        </div>
        <button className="btn-new-session" onClick={createSession}>+ 新建对话</button>
        <div className="session-list">
          {sessions.sort((a,b) => b.updatedAt - a.updatedAt).map(session => (
            <div 
              key={session.id} 
              className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
              onClick={() => setActiveSessionId(session.id)}
            >
              <span className="session-name" title={session.name}>{session.name}</span>
              <button 
                className="btn-delete-session" 
                onClick={(e) => deleteSession(e, session.id)}
                title="删除对话"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="chat-main">
        <div className="chat-header">
          {activeSession?.name || '加载中...'}
        </div>
        
        <div className="chat-messages">
          {activeSession?.messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              {msg.parts[0].text}
            </div>
          ))}
          {isLoading && <div className="loading-indicator">AI 正在回复中...</div>}
          <div ref={messagesEndRef} />
        </div>

        <ChatInput onSend={handleSend} disabled={isLoading} />
      </div>

      {/* Right Sidebar - Settings */}
      <div className="sidebar-right">
        <div className="sidebar-header">模型配置</div>
        
        <div className="settings-content">
          <div className="setting-group">
            <label>API 密钥 (API Key)</label>
            <input 
              type="password" 
              value={config.apiKey} 
              onChange={e => setConfig({...config, apiKey: e.target.value})}
              placeholder="请输入 Vertex AI Key"
            />
          </div>

          <div className="setting-group">
            <label>项目 ID (Project ID)</label>
            <input 
              type="text" 
              value={config.projectId} 
              onChange={e => setConfig({...config, projectId: e.target.value})}
            />
          </div>

          <div className="setting-group">
            <label>区域 (Location)</label>
            <select 
              value={config.location} 
              onChange={e => setConfig({...config, location: e.target.value})}
            >
              <option value="us-central1">us-central1 (爱荷华)</option>
              <option value="us-east4">us-east4 (北弗吉尼亚)</option>
              <option value="us-west1">us-west1 (俄勒冈)</option>
              <option value="us-west4">us-west4 (拉斯维加斯)</option>
              <option value="europe-west1">europe-west1 (比利时)</option>
              <option value="europe-west2">europe-west2 (伦敦)</option>
              <option value="europe-west3">europe-west3 (法兰克福)</option>
              <option value="europe-west4">europe-west4 (荷兰)</option>
              <option value="europe-west9">europe-west9 (巴黎)</option>
              <option value="asia-northeast1">asia-northeast1 (东京)</option>
              <option value="asia-northeast3">asia-northeast3 (首尔)</option>
              <option value="asia-southeast1">asia-southeast1 (新加坡)</option>
              <option value="asia-east1">asia-east1 (台湾)</option>
              <option value="asia-east2">asia-east2 (香港)</option>
              <option value="me-central1">me-central1 (多哈)</option>
            </select>
          </div>

          <div className="setting-group">
            <label>模型名称 (Model ID)</label>
            <select 
              value={config.modelId} 
              onChange={e => setConfig({...config, modelId: e.target.value})}
            >
              <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
              <option value="gemini-3.1-flash-lite-preview">gemini-3.1-flash-lite-preview</option>
              <option value="gemini-1.5-pro-002">gemini-1.5-pro-002</option>
              <option value="gemini-1.5-pro-001">gemini-1.5-pro-001</option>
              <option value="gemini-1.5-flash-002">gemini-1.5-flash-002</option>
              <option value="gemini-1.5-flash-001">gemini-1.5-flash-001</option>
              <option value="gemini-1.5-flash-8b-001">gemini-1.5-flash-8b-001</option>
              <option value="gemini-1.0-pro-002">gemini-1.0-pro-002</option>
            </select>
          </div>

          <div className="setting-group">
            <div 
              className="setting-group-header"
              onClick={() => setIsSystemPromptOpen(!isSystemPromptOpen)}
            >
              <label style={{cursor: 'pointer'}}>系统提示词 (System Prompt)</label>
              <span className="toggle-icon">{isSystemPromptOpen ? '▼' : '▶'}</span>
            </div>
            {isSystemPromptOpen && (
              <textarea 
                value={config.systemPrompt} 
                onChange={e => setConfig({...config, systemPrompt: e.target.value})}
                placeholder="在此输入系统提示词..."
              />
            )}
          </div>

          <div className="setting-group">
            <label>思考等级 (Thinking Level)</label>
            <select 
              value={config.thinkingLevel} 
              onChange={e => setConfig({...config, thinkingLevel: e.target.value})}
            >
              <option value="OFF">关闭 (OFF)</option>
              <option value="LOW">低 (LOW)</option>
              <option value="MEDIUM">中 (MEDIUM)</option>
              <option value="HIGH">高 (HIGH)</option>
            </select>
          </div>

          <div className="setting-group">
            <label>安全性设置 (Safety Settings)</label>
            <select 
              value={config.safetyLevel} 
              onChange={e => setConfig({...config, safetyLevel: parseInt(e.target.value)})}
            >
              <option value="0">全部关闭 (OFF / Block None)</option>
              <option value="1">拦截极少量 (Block Only High)</option>
              <option value="2">拦截部分 (Block Medium+)</option>
              <option value="3">拦截大部分 (Block Low+)</option>
            </select>
            <div className="setting-hint">默认推荐设置为关闭。</div>
          </div>

          <div className="setting-group">
            <div className="setting-group-header">
              <label>最高 Token 限制 (Max Tokens)</label>
              <span className="value-display">{config.maxOutputTokens}</span>
            </div>
            <input 
              type="range" 
              min="1" max="65535" step="1"
              value={config.maxOutputTokens} 
              onChange={e => setConfig({...config, maxOutputTokens: parseInt(e.target.value)})}
            />
          </div>

          <div className="setting-group">
            <div className="setting-group-header">
              <label>温度 (Temperature)</label>
              <span className="value-display">{config.temperature}</span>
            </div>
            <input 
              type="range" 
              min="0" max="2" step="0.1"
              value={config.temperature} 
              onChange={e => setConfig({...config, temperature: parseFloat(e.target.value)})}
            />
          </div>

          <div className="setting-group">
            <div className="setting-group-header">
              <label>核采样参数 (Top-P)</label>
              <span className="value-display">{config.topP}</span>
            </div>
            <input 
              type="range" 
              min="0" max="1" step="0.01"
              value={config.topP} 
              onChange={e => setConfig({...config, topP: parseFloat(e.target.value)})}
            />
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
