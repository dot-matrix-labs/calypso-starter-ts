export type EntityType = 'user' | 'task' | 'tag' | 'github_link' | 'channel' | 'message';

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

// ---------------------------------------------------------------------------
// JSON Schemas for server-side validation and integration test fixtures
// ---------------------------------------------------------------------------

/** JSON Schema for creating a new task (POST /api/tasks body). */
export const createTaskSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    owner: { type: 'string' },
    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
    estimateStart: { type: ['string', 'null'] },
    estimatedDeliver: { type: ['string', 'null'] },
    dependsOn: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['name'],
  additionalProperties: false,
} as const;

/** JSON Schema for patching an existing task (PATCH /api/tasks/:id body). */
export const patchTaskSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    owner: { type: 'string' },
    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
    estimateStart: { type: ['string', 'null'] },
    estimatedDeliver: { type: ['string', 'null'] },
    dependsOn: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
} as const;

/** JSON Schema for user registration (POST /api/auth/register body). */
export const registerUserSchema = {
  type: 'object',
  properties: {
    username: { type: 'string', minLength: 1 },
    password: { type: 'string', minLength: 6 },
  },
  required: ['username', 'password'],
  additionalProperties: false,
} as const;

/** JSON Schema for user login (POST /api/auth/login body). */
export const loginUserSchema = {
  type: 'object',
  properties: {
    username: { type: 'string', minLength: 1 },
    password: { type: 'string', minLength: 1 },
  },
  required: ['username', 'password'],
  additionalProperties: false,
} as const;
