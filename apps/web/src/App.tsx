import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import {
  MessageSquare,
  Settings,
  Plus,
  User,
  LayoutDashboard,
  ChevronRight,
  ChevronLeft,
  Users,
} from 'lucide-react';
import { TaskListView } from './components/TaskListView';
import { PersonsView } from './components/PersonsView';
import { StudioChat } from './components/StudioChat';

type ActiveView = 'board' | 'persons' | 'settings';

function App() {
  const { user, logout, loading } = useAuth();

  // Core Layout State
  const [activeView, setActiveView] = useState<ActiveView>('board');
  const [chatExpanded, setChatExpanded] = useState(true);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="flex h-screen w-full bg-zinc-50 font-sans overflow-hidden text-zinc-900">
      {/* Left Sidebar - Extremely slim icon navigation */}
      <nav className="w-16 shrink-0 border-r border-zinc-200 bg-white flex flex-col items-center py-6 justify-between z-10">
        <div className="flex flex-col items-center gap-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-black text-lg">C</span>
          </div>

          <div className="flex flex-col gap-4 mt-4 w-full px-2">
            <button
              onClick={() => setActiveView('board')}
              className={`p-3 rounded-xl flex items-center justify-center transition-all ${activeView === 'board' ? 'bg-indigo-50 text-indigo-600' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'}`}
              title="Task board"
            >
              <LayoutDashboard size={20} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => setActiveView('persons')}
              className={`p-3 rounded-xl flex items-center justify-center transition-all ${activeView === 'persons' ? 'bg-indigo-50 text-indigo-600' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'}`}
              title="People & relationships"
            >
              <Users size={20} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => setActiveView('settings')}
              className={`p-3 rounded-xl flex items-center justify-center transition-all ${activeView === 'settings' ? 'bg-indigo-50 text-indigo-600' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'}`}
              title="Settings"
            >
              <Settings size={20} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4">
          <button
            onClick={logout}
            className="w-10 h-10 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-red-500 outline-none"
          >
            <User size={18} />
          </button>
        </div>
      </nav>

      {/* Main Application Area */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Full-width Project Board Panel */}
        <div className="flex-1 flex flex-col bg-white">
          {/* Board Header */}
          <header className="h-12 px-5 border-b border-zinc-200 flex items-center justify-between shrink-0 bg-white shadow-sm">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 ring-2 ring-indigo-100" />
              <h1 className="text-sm font-semibold tracking-tight text-zinc-900">
                {activeView === 'persons' ? 'CRM — Relationships' : 'Main Project'}
              </h1>
              <span className="text-zinc-200 font-light text-base leading-none">/</span>
              <span className="text-xs text-zinc-400 font-medium">dot-matrix-labs/calypso</span>
            </div>
            {activeView === 'board' && (
              <button
                onClick={() => {
                  const event = new CustomEvent('calypso:new-task');
                  window.dispatchEvent(event);
                }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-md transition-colors flex items-center gap-1.5"
              >
                <Plus size={13} strokeWidth={2.5} />
                New Task
              </button>
            )}
          </header>

          {/* Board Content */}
          <div className="flex-1 overflow-hidden">
            {activeView === 'board' && <TaskListView />}
            {activeView === 'persons' && <PersonsView />}
            {activeView === 'settings' && (
              <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
                Settings coming soon
              </div>
            )}
          </div>
        </div>

        {/* Studio Chat Overlay */}
        <div
          className={`absolute right-0 top-0 bottom-0 transition-transform duration-300 ease-in-out ${
            chatExpanded ? 'translate-x-0' : 'translate-x-full'
          }`}
          style={{ width: '420px', maxWidth: '50vw' }}
        >
          {/* Toggle Button (visible when chat is collapsed) */}
          {!chatExpanded && (
            <button
              onClick={() => setChatExpanded(true)}
              className="absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 bg-zinc-900 text-white p-3 rounded-l-lg shadow-lg hover:bg-zinc-800 transition-colors flex items-center gap-2"
            >
              <MessageSquare size={18} className="text-indigo-400" />
              <span className="text-sm font-medium">Studio</span>
              <ChevronLeft size={16} />
            </button>
          )}

          {/* Chat Panel */}
          <div className="h-full flex flex-col bg-zinc-50 border-l border-zinc-200 shadow-xl">
            {/* Studio Chat Header with Minimize */}
            <header className="h-16 px-6 border-b border-zinc-200 flex items-center justify-between shrink-0 bg-white">
              <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider text-zinc-800">
                <MessageSquare size={16} className="text-indigo-500" />
                Studio
              </h2>
              <button
                onClick={() => setChatExpanded(false)}
                className="p-2 hover:bg-zinc-100 rounded-lg transition-colors text-zinc-400 hover:text-zinc-600"
                title="Minimize chat"
              >
                <ChevronRight size={18} />
              </button>
            </header>

            <StudioChat />
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Root() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}
