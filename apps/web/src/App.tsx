/**
 * @file overview
 * The root Application component for the Weekly Recap Newsletter frontend.
 * This component will eventually host the WYSIWYG editor, the dynamic
 * feed views for Yahoo/Bloomberg, and the template preview layout.
 */

import React, { useState } from 'react';
import { Article } from 'core';
import { FeedSidebar } from './components/FeedSidebar';
import { DraftEditor } from './components/DraftEditor';
import { ExportModal } from './components/ExportModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './components/Login';

function Dashboard() {
    const { user, logout } = useAuth();
    const [currentDraftId, setCurrentDraftId] = useState<string | undefined>(undefined);
    const [synopsis, setSynopsis] = useState('');
    const [selectedArticles, setSelectedArticles] = useState<Article[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const handleSaveDraft = async () => {
        setIsSaving(true);
        try {
            const res = await fetch('/api/drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    id: currentDraftId,
                    synopsis,
                    articles: selectedArticles
                })
            });
            const data = await res.json();
            if (data.id && !currentDraftId) setCurrentDraftId(data.id);
            alert('Draft saved successfully!');
        } catch (err) {
            alert('Failed to save draft');
            console.error(err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleLoadDraft = (draft: any) => {
        setCurrentDraftId(draft.id);
        setSynopsis(draft.synopsis);
        setSelectedArticles(draft.articles || []);
    };

    const handleAddArticle = (article: Article) => {
        if (selectedArticles.length >= 5) {
            alert("You can only select up to 5 articles for the weekly recap.");
            return;
        }
        if (selectedArticles.find(a => a.id === article.id)) {
            return; // already added
        }
        setSelectedArticles([...selectedArticles, article]);
    };

    const handleRemoveArticle = (id: string) => {
        setSelectedArticles(selectedArticles.filter(a => a.id !== id));
    };

    return (
        <div className="flex bg-gray-100 font-sans relative" style={{ height: '100vh', overflow: 'hidden' }}>
            {/* Top-right corner identity overlay */}
            <div className="absolute top-4 right-4 z-50 flex items-center gap-4 bg-white px-4 py-2 rounded-full shadow-sm border border-gray-200">
                <span className="text-sm font-medium text-gray-700">👤 {user?.username}</span>
                <button onClick={logout} className="text-sm text-red-600 hover:text-red-800 font-medium transition-colors">Sign Out</button>
            </div>

            <FeedSidebar
                onAddArticle={handleAddArticle}
                onLoadDraft={handleLoadDraft}
            />
            <DraftEditor
                synopsis={synopsis}
                setSynopsis={setSynopsis}
                articles={selectedArticles}
                onRemoveArticle={handleRemoveArticle}
                onSaveDraft={handleSaveDraft}
                isSaving={isSaving}
            />
            <ExportModal synopsis={synopsis} articles={selectedArticles} />
        </div>
    );
}

function AppContent() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!user) {
        return <Login />;
    }

    return <Dashboard />;
}

function App() {
    return (
        <AuthProvider>
            <AppContent />
        </AuthProvider>
    );
}

export default App;
