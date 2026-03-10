import React, { useState } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { MessageSquare, Settings, Plus, User, LayoutDashboard } from 'lucide-react';
import { TaskListView } from './components/TaskListView';

function App() {
  const { user, logout, loading } = useAuth();

  // Core Layout State
  const [activeView, setActiveView] = useState<'board' | 'settings'>('board');

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
            >
              <LayoutDashboard size={20} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => setActiveView('settings')}
              className={`p-3 rounded-xl flex items-center justify-center transition-all ${activeView === 'settings' ? 'bg-indigo-50 text-indigo-600' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'}`}
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

      {/* Main Application Area (Resizable Panels) */}
      <main className="flex-1 flex overflow-hidden">
        <Group orientation="horizontal">
          {/* 3/4 Project Board Panel */}
          <Panel defaultSize={75} minSize={50} className="flex flex-col bg-white">
            {/* Board Header */}
            <header className="h-16 px-8 border-b border-zinc-200 flex items-center justify-between shrink-0">
              <div>
                <h1 className="text-xl font-bold tracking-tight">Main Project</h1>
                <p className="text-sm text-zinc-500 font-medium">
                  Synced with github.com/dot-matrix-labs/calypso
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const event = new CustomEvent('calypso:new-task');
                    window.dispatchEvent(event);
                  }}
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2"
                >
                  <Plus size={16} />
                  New Task
                </button>
              </div>
            </header>

            {/* Board Content */}
            <div className="flex-1 overflow-hidden">
              <TaskListView />
            </div>
          </Panel>

          {/* Resizable Divider */}
          <Separator className="w-px bg-zinc-200 hover:w-1 hover:bg-indigo-400 transition-all duration-150 delay-75 cursor-col-resize z-20" />

          {/* 1/4 Chat Window Panel */}
          <Panel defaultSize={25} minSize={20} maxSize={40} className="flex flex-col bg-zinc-50">
            {/* Chat Header */}
            <header className="h-16 px-6 border-b border-zinc-200 flex items-center shrink-0 bg-white">
              <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider text-zinc-800">
                <MessageSquare size={16} className="text-indigo-500" />
                Team Chat
              </h2>
            </header>

            {/* Chat View (Empty State) */}
            <div className="flex-1 overflow-auto p-6 flex flex-col">
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-xl bg-white border border-zinc-200 shadow-sm flex items-center justify-center mb-4">
                  <MessageSquare className="text-zinc-300" size={20} />
                </div>
                <p className="text-sm text-zinc-500 font-medium">
                  It&apos;s quiet in here.
                  <br />
                  Send a message to start collaborating.
                </p>
              </div>
            </div>

            {/* Chat Input Area */}
            <div className="p-4 bg-white border-t border-zinc-200 shrink-0">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Type a message or use /assign..."
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow placeholder:text-zinc-400"
                />
              </div>
            </div>
          </Panel>
        </Group>
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
