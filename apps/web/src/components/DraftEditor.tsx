import React from 'react';
import { Article } from 'core';

interface Props {
    synopsis: string;
    setSynopsis: (s: string) => void;
    articles: Article[];
    onRemoveArticle: (id: string) => void;
    onSaveDraft: () => void;
    isSaving: boolean;
}

export const DraftEditor: React.FC<Props> = ({ synopsis, setSynopsis, articles, onRemoveArticle, onSaveDraft, isSaving }) => {
    return (
        <div className="flex-1 flex flex-col h-full bg-white overflow-hidden relative">
            <div className="p-6 border-b border-gray-200 bg-white sticky top-0 z-10 flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Weekly Recap Draft</h2>
                    <p className="text-sm text-gray-500">Select up to 5 standard top articles for your email newsletter.</p>
                </div>
                <button
                    onClick={onSaveDraft}
                    disabled={isSaving}
                    className="bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                    {isSaving ? "Saving..." : "Save Draft"}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-gray-50">
                <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden break-words">
                    <div className="px-5 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                        <h3 className="font-semibold text-gray-700">Journalist Synopsis</h3>
                    </div>
                    <textarea
                        className="w-full h-48 p-5 resize-none border-none focus:ring-0 text-gray-800 leading-relaxed placeholder-gray-400"
                        placeholder="Write your insightful breakdown of this week's news..."
                        value={synopsis}
                        onChange={(e) => setSynopsis(e.target.value)}
                    />
                </section>

                <section>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-lg text-gray-800">Selected Articles</h3>
                        <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-1 rounded-full">
                            {articles.length} / 5
                        </span>
                    </div>

                    {articles.length === 0 ? (
                        <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
                            <p className="text-gray-500 mb-2">No articles selected yet.</p>
                            <p className="text-sm text-gray-400">Search and click &quot;Add to Auth&quot; in the sidebar to curate stories.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {articles.map((article, idx) => (
                                <div key={article.id} className="bg-white border border-gray-200 rounded-xl p-5 flex gap-4 shadow-sm group">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="font-bold text-gray-900 mb-1 leading-tight">{article.title}</h4>
                                        <p className="text-sm text-gray-600 mb-2">{article.snippet}</p>
                                        <a href={article.link} className="text-sm text-blue-600 hover:underline break-all" target="_blank" rel="noopener noreferrer">
                                            {article.link}
                                        </a>
                                    </div>
                                    <button
                                        className="flex-shrink-0 self-start text-gray-400 hover:text-red-500 transition-colors p-2 -mr-2 -mt-2 rounded-full hover:bg-red-50 focus:outline-none"
                                        onClick={() => onRemoveArticle(article.id)}
                                        aria-label="Remove article"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};
