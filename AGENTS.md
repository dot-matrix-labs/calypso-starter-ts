---
description: Default execution context and agent instructions
---

# Calypso Agent Config

<!-- last-edited: 2026-03-10 -->

# ALWAYS

- _TDD_ Do test driven development.
- _CURRICULUM_ Select a list of document to read in order to learn what the task is about.
- _DONT ASK_ If you are not confident in your solution read more documents.

## CURRICULUM

### P1: Orient

1. READ `agent-context/index.md` (Document graph & keyword index).
2. READ `docs/plans/next-prompt.md` IF exists (Assigned task).
3. IF no task assigned: ASK human "What should I build?". (ONLY valid reason to ask here).

### P2: Select Workflow

Match task to EXACTLY ONE workflow in `agent-context/development/`. READ & STRICTLY FOLLOW it:

- Feature/Module -> `development-standards.md`
- Hardening/Security -> `hardening.md`
- Documentation -> `documentation-standard.md`
- Requirements -> `product-owner-interview.md`
- Scaffold -> `init/scaffold-task.md`

### P3: Load Implementation Context

1. READ domain implementation doc (via Task Routing in `agent-context/index.md`).
2. STOP reading here. This is sufficient. BEGIN WORK.

### P4: Context Escalation (ON UNCERTAINTY ONLY)

IF design decision blocked during implementation:

1. CHECK: Solvable from implementation doc? YES -> WORK. NO -> PROCEED.
2. READ `agent-context/index.md` keyword index.
3. IDENTIFY matching blueprint(s).
4. READ ONLY relevant blueprint section. Apply & Return to WORK.
5. IF STILL BLOCKED: READ `agent-communication.md` §Document Precedence Rules.
6. IF STILL BLOCKED: Search codebase for analogous patterns. Use simplest pattern.
7. IF STILL BLOCKED: ASK human. State explicitly: [Tried], [Found], [Decision Needed].
