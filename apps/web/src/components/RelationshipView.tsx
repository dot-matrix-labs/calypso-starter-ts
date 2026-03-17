import React, { useEffect, useState } from 'react';
import type { Person, Relationship, RelationshipScore } from 'core';
import { RELATIONSHIP_SCORE_LABELS } from 'core';
import { Plus, X } from 'lucide-react';

const SCORE_COLORS: Record<RelationshipScore, string> = {
  1: 'bg-zinc-100 text-zinc-500',
  2: 'bg-blue-50 text-blue-500',
  3: 'bg-amber-50 text-amber-600',
  4: 'bg-indigo-50 text-indigo-600',
  5: 'bg-emerald-50 text-emerald-600',
};

function ScoreBadge({ score }: { score: RelationshipScore }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${SCORE_COLORS[score]}`}
    >
      {score}/5
    </span>
  );
}

interface RelationshipFormProps {
  persons: Person[];
  onCreated: (rel: Relationship) => void;
  onClose: () => void;
  defaultPersonAId?: string;
}

function RelationshipForm({
  persons,
  onCreated,
  onClose,
  defaultPersonAId,
}: RelationshipFormProps) {
  const [personAId, setPersonAId] = useState(defaultPersonAId ?? '');
  const [personBId, setPersonBId] = useState('');
  const [score, setScore] = useState<number>(3);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!personAId || !personBId) return;
    setSaving(true);
    setError('');
    const res = await fetch('/api/relationships', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personAId, personBId, score, reason }),
    });
    if (res.ok) {
      const created: Relationship = await res.json();
      onCreated(created);
    } else {
      const body = await res.json();
      setError((body as { error?: string }).error ?? 'Failed to create relationship');
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 border border-zinc-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-zinc-900">New Relationship</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-100 rounded-lg transition-colors text-zinc-400"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Person A *
              </label>
              <select
                required
                value={personAId}
                onChange={(e) => setPersonAId(e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select…</option>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Person B *
              </label>
              <select
                required
                value={personBId}
                onChange={(e) => setPersonBId(e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select…</option>
                {persons
                  .filter((p) => p.id !== personAId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
              Relationship Strength *
            </label>
            <div className="flex gap-2">
              {([1, 2, 3, 4, 5] as RelationshipScore[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScore(s)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    score === s
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              {score}/5 — {RELATIONSHIP_SCORE_LABELS[score as RelationshipScore]}
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
              Reason / Context
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="Describe the context of this relationship…"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-zinc-900 text-white text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Relationship'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface RelationshipViewProps {
  personId: string;
  persons: Person[];
  onPersonsChange: () => void;
}

export function RelationshipView({ personId, persons, onPersonsChange }: RelationshipViewProps) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/persons/${personId}/relationships`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data: Relationship[]) => setRelationships(data))
      .finally(() => setLoading(false));
  }, [personId]);

  function getOtherPerson(rel: Relationship) {
    const otherId = rel.personAId === personId ? rel.personBId : rel.personAId;
    return persons.find((p) => p.id === otherId);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-700 uppercase tracking-wide">
          Relationships
        </h3>
        <button
          onClick={() => setShowForm(true)}
          className="p-1 hover:bg-zinc-100 rounded-lg transition-colors text-zinc-400 hover:text-zinc-600"
          title="New relationship"
        >
          <Plus size={16} />
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-zinc-400">Loading…</p>
      ) : relationships.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">
          No relationships defined. Score: 0 / no relationship
        </p>
      ) : (
        <ul className="space-y-2">
          {relationships.map((rel) => {
            const other = getOtherPerson(rel);
            return (
              <li
                key={rel.id}
                className="flex items-start gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-100"
              >
                <ScoreBadge score={rel.score} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900">
                    {other?.name ?? '(unknown)'}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">
                    {RELATIONSHIP_SCORE_LABELS[rel.score]}
                  </p>
                  {rel.reason && (
                    <p className="text-xs text-zinc-400 mt-0.5 italic">{rel.reason}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {showForm && (
        <RelationshipForm
          persons={persons}
          defaultPersonAId={personId}
          onCreated={(rel) => {
            setRelationships((prev) => [rel, ...prev]);
            setShowForm(false);
            onPersonsChange();
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
