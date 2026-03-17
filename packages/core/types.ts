export type EntityType =
  | 'user'
  | 'task'
  | 'tag'
  | 'github_link'
  | 'channel'
  | 'message'
  | 'person'
  | 'relationship';

export interface Entity {
  id: string;
  type: EntityType;
  properties: Record<string, unknown>;
  tenant_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Relation {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  properties: Record<string, unknown>;
  created_at: string;
}

// Calypso Specific semantic properties mapped from the Entity JSONB
// Policy note: this starter app stores password hashes inside the generic user
// entity payload. The target blueprint posture replaces this with passkey-first
// auth, dedicated auth/audit controls, and stricter separation between identity
// material and general business entities.
export interface UserProperties {
  username: string;
  password_hash: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  name: string;
  description: string;
  owner: string;
  priority: TaskPriority;
  status: TaskStatus;
  estimateStart: string | null;
  estimatedDeliver: string | null;
  dependsOn: string[];
  tags: string[];
  targetPersonId: string | null;
  createdAt: string;
}

export interface TaskProperties {
  name: string;
  description: string;
  owner: string;
  priority: TaskPriority;
  status: TaskStatus;
  estimateStart: string | null;
  estimatedDeliver: string | null;
  dependsOn: string[];
  tags: string[];
  targetPersonId?: string | null;
}

// Policy note: a starter-level task update is still modeled as a mutable entity
// rewrite. Consequential future workflows should move to a journaled write
// boundary so state changes can be replayed, compensated, and attributed.

export interface GithubLinkProperties {
  issueNumber: number;
  repository: string;
  status: 'open' | 'closed';
  url: string;
}

// ── hot-or-not CRM types ────────────────────────────────────────────────────

/**
 * Update tempo describes how frequently a biographical data field should be
 * refreshed. Stable fields (e.g. education) change rarely; volatile fields
 * (e.g. current city) may change often.
 */
export type UpdateTempo = 'stable' | 'annual' | 'quarterly' | 'monthly';

export interface EducationEntry {
  school: string;
  degree: string;
  startYear?: number;
  endYear?: number;
}

export interface EmploymentEntry {
  company: string;
  title: string;
  startYear?: number;
  endYear?: number | null;
}

export interface BoardEntry {
  organization: string;
  role: string;
  startYear?: number;
  endYear?: number | null;
}

export interface PartTimeRoleEntry {
  organization: string;
  role: string;
}

export interface GeographyEntry {
  city: string;
  country: string;
  current: boolean;
}

export interface DonationEntry {
  recipient: string;
  amount?: number;
  year?: number;
}

export interface ConferencePresentationEntry {
  conference: string;
  title: string;
  year?: number;
}

export interface PressQuoteEntry {
  publication: string;
  quote: string;
  year?: number;
}

/**
 * Biographical data stored as JSONB. Each field is an array of typed entries
 * plus a configurable update tempo so operators can schedule refresh cadences.
 */
export interface PersonProperties {
  name: string;
  education: { tempo: UpdateTempo; entries: EducationEntry[] };
  employment: { tempo: UpdateTempo; entries: EmploymentEntry[] };
  boardPositions: { tempo: UpdateTempo; entries: BoardEntry[] };
  partTimeRoles: { tempo: UpdateTempo; entries: PartTimeRoleEntry[] };
  geography: { tempo: UpdateTempo; entries: GeographyEntry[] };
  hobbies: { tempo: UpdateTempo; entries: string[] };
  donations: { tempo: UpdateTempo; entries: DonationEntry[] };
  family: {
    tempo: UpdateTempo;
    married: boolean | null;
    children: number | null;
  };
  conferences: { tempo: UpdateTempo; entries: ConferencePresentationEntry[] };
  pressQuotes: { tempo: UpdateTempo; entries: PressQuoteEntry[] };
}

export interface Person {
  id: string;
  name: string;
  properties: PersonProperties;
  createdAt: string;
  updatedAt: string;
}

export type RelationshipScore = 1 | 2 | 3 | 4 | 5;

export const RELATIONSHIP_SCORE_LABELS: Record<RelationshipScore, string> = {
  1: 'Contato incidental',
  2: 'Contato periférico',
  3: 'Contato profissional regular',
  4: 'Relação profissional sustentada',
  5: 'Vínculo institucional profundo',
};

export interface RelationshipProperties {
  personAId: string;
  personBId: string;
  score: RelationshipScore;
  reason: string;
}

export interface Relationship {
  id: string;
  personAId: string;
  personBId: string;
  score: RelationshipScore;
  reason: string;
  createdAt: string;
}
