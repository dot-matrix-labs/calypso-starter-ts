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
export interface UserProperties {
    username: string;
    password_hash: string;
}

export interface TaskProperties {
    name: string;
    description: string;
    owner: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    estimateStart?: string;
    estimatedDeliver?: string;
}

export interface GithubLinkProperties {
    issueNumber: number;
    repository: string;
    status: 'open' | 'closed';
    url: string;
}
