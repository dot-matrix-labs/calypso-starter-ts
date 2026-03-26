import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { Settings, Plus, User, LayoutDashboard, Smartphone, Shield } from 'lucide-react';
import { TaskListView } from './components/TaskListView';
import { PwaDemoPage } from './pages/pwa-demo';
import { AdminDashboard } from './pages/admin-dashboard';

function App() {
  const { user, logout, loading } = useAuth();

  // Core Layout State
  const [activeView, setActiveView] = useState<'board' | 'settings' | 'pwa' | 'admin'>('board');

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
            <button
              onClick={() => setActiveView('pwa')}
              className={`p-3 rounded-xl flex items-center justify-center transition-all ${activeView === 'pwa' ? 'bg-indigo-50 text-indigo-600' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'}`}
              title="PWA Demo"
            >
              <Smartphone size={20} strokeWidth={2.5} />
            </button>
            {user.isSuperadmin && (
              <button
                onClick={() => setActiveView('admin')}
                className={`p-3 rounded-xl flex items-center justify-center transition-all ${activeView === 'admin' ? 'bg-indigo-50 text-indigo-600' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'}`}
                title="Admin Dashboard"
              >
                <Shield size={20} strokeWidth={2.5} />
              </button>
            )}
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
              <h1 className="text-sm font-semibold tracking-tight text-zinc-900">Main Project</h1>
              <span className="text-zinc-200 font-light text-base leading-none">/</span>
              <span className="text-xs text-zinc-400 font-medium">dot-matrix-labs/calypso</span>
            </div>
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
          </header>

          {/* Board Content */}
          <div className="flex-1 overflow-hidden overflow-y-auto">
            {activeView === 'board' && <TaskListView />}
            {activeView === 'pwa' && <PwaDemoPage />}
            {activeView === 'admin' && user.isSuperadmin && <AdminDashboard />}
            {activeView === 'admin' && !user.isSuperadmin && (
              <div className="p-8 text-zinc-400 text-sm">
                Access denied. Superadmin privileges required.
              </div>
            )}
            {activeView === 'settings' && (
              <div className="p-8 text-zinc-400 text-sm">Settings coming soon.</div>
            )}
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
