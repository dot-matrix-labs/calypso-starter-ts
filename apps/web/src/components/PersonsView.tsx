import React, { useEffect, useState } from 'react';
import type { Person } from 'core';
import { Plus, UserCircle } from 'lucide-react';
import { PersonForm } from './PersonForm';
import { RelationshipView } from './RelationshipView';

export function PersonsView() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function loadPersons() {
    setLoading(true);
    fetch('/api/persons', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: Person[]) => setPersons(data))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadPersons();
  }, []);

  const selected = persons.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      {/* List panel */}
      <div className="w-72 shrink-0 border-r border-zinc-100 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
          <h2 className="text-sm font-semibold text-zinc-700">Pessoas</h2>
          <button
            onClick={() => setShowForm(true)}
            className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-md transition-colors flex items-center gap-1"
          >
            <Plus size={12} strokeWidth={2.5} />
            Nova
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-16 text-zinc-400 text-xs">
              Carregando…
            </div>
          ) : persons.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <p className="text-zinc-400 text-xs">Nenhuma pessoa cadastrada.</p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-2 text-indigo-600 text-xs hover:underline"
              >
                Criar a primeira
              </button>
            </div>
          ) : (
            <ul>
              {persons.map((person) => (
                <li key={person.id}>
                  <button
                    onClick={() => setSelectedId(person.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-zinc-50 ${
                      selectedId === person.id
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'hover:bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    <UserCircle size={18} className="shrink-0 text-zinc-300" />
                    <span className="text-sm font-medium truncate">{person.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-auto p-6">
        {selected ? (
          <div className="max-w-xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center">
                <UserCircle size={24} className="text-indigo-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-zinc-900">{selected.name}</h2>
                <p className="text-xs text-zinc-400">
                  Criado em{' '}
                  {new Date(selected.createdAt).toLocaleDateString('pt-BR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <RelationshipView
                personId={selected.id}
                persons={persons}
                onPersonsChange={loadPersons}
              />

              {/* Biographical data summary */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 uppercase tracking-wide mb-3">
                  Dados Biográficos
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <BiographySection
                    label="Educação"
                    tempo={selected.properties.education.tempo}
                    count={selected.properties.education.entries.length}
                  />
                  <BiographySection
                    label="Empregos"
                    tempo={selected.properties.employment.tempo}
                    count={selected.properties.employment.entries.length}
                  />
                  <BiographySection
                    label="Conselhos"
                    tempo={selected.properties.boardPositions.tempo}
                    count={selected.properties.boardPositions.entries.length}
                  />
                  <BiographySection
                    label="Funções Part-time"
                    tempo={selected.properties.partTimeRoles.tempo}
                    count={selected.properties.partTimeRoles.entries.length}
                  />
                  <BiographySection
                    label="Geografia"
                    tempo={selected.properties.geography.tempo}
                    count={selected.properties.geography.entries.length}
                  />
                  <BiographySection
                    label="Hobbies"
                    tempo={selected.properties.hobbies.tempo}
                    count={selected.properties.hobbies.entries.length}
                  />
                  <BiographySection
                    label="Doações"
                    tempo={selected.properties.donations.tempo}
                    count={selected.properties.donations.entries.length}
                  />
                  <BiographySection
                    label="Apresentações"
                    tempo={selected.properties.conferences.tempo}
                    count={selected.properties.conferences.entries.length}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-300 text-sm">
            Selecione uma pessoa para ver os detalhes
          </div>
        )}
      </div>

      {showForm && (
        <PersonForm
          onCreated={(person) => {
            setPersons((prev) => [person, ...prev]);
            setSelectedId(person.id);
            setShowForm(false);
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function BiographySection({
  label,
  tempo,
  count,
}: {
  label: string;
  tempo: string;
  count: number;
}) {
  const tempoLabels: Record<string, string> = {
    stable: 'estável',
    annual: 'anual',
    quarterly: 'trimestral',
    monthly: 'mensal',
  };
  return (
    <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100">
      <p className="font-semibold text-zinc-600">{label}</p>
      <p className="text-zinc-400 mt-0.5">
        {count} {count === 1 ? 'registro' : 'registros'} · {tempoLabels[tempo] ?? tempo}
      </p>
    </div>
  );
}
