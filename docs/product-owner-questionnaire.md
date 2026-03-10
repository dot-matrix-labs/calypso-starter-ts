# Product Owner Questionnaire

Based on your initial description, I've pre-filled this questionnaire to define the requirements for the hybrid project management and chat application.

Please review the inferred answers below. You can edit them, confirm them, or select from the multiple-choice options where I needed more information.

> **Product Description:** A hybrid of GitHub Projects, Jira, Asana, and Slack. It features a right 1/4 chat window (online status, direct messaging, slash commands) and a main 3/4 project management board with three views: list (Asana-style), kanban (GitHub-style), and Gantt waterfall with dependencies. It will have READ access to GitHub issues and PR status.

---

### 1. Product Vision & Value Proposition

**What is the core problem this application solves for the user?**

> **Inferred Answer:** It eliminates the need for teams to switch context between separate chat apps (like Slack), task trackers (like Jira/Asana), and code repositories (GitHub). It centralizes communication and project tracking in one unified interface.

**How does the user currently solve this problem, and how is this application better?**

> **Inferred Answer:** Users currently juggle multiple tabs and apps, losing context and time. This application is better because it provides tight, side-by-side integration of real-time chat and multi-view project management, deeply linked with live GitHub status.

**What does a successful outcome look like for the primary user?**

> **Inferred Answer:** A user can view their tasks in their preferred layout, instantly see if a blocking GitHub PR is merged, and ping a teammate about it without ever leaving the dashboard.

---

### 2. Core Workflows & User Stories

**Describe the "Happy Path" workflow from the moment a user signs up to the moment they achieve their primary goal.**

> **Inferred Answer:**
>
> 1. User logs in and connects their GitHub account.
> 2. User sees the main dashboard split into the Project Board (3/4) and Chat (1/4).
> 3. User creates a new task on the board in List or Kanban view, linking a GitHub issue.
> 4. User sees team members online in the chat window and uses a slash command (e.g., `/assign @colleague`) or sends a direct message to coordinate work.
> 5. As GitHub PRs are updated, the linked tasks on the board automatically reflect the new READ status.

**What are the most common edge cases or alternative workflows a user might take?**

> **Please select or edit:**
>
> - [ ] A user wants to view the Gantt chart to adjust dependent task timelines when a GitHub PR is delayed.
> - [ ] A user is offline or disconnected from chat but still needs to update board tasks.
> - [ ] A slash command fails (e.g., trying to assign an invalid user or repository).
> - [ ] Other — please specify: \***\*\*\*\*\***\_\_\***\*\*\*\*\***

**Are there complex state machines for entities?**
_(Specific questions on entities)_

- **Tasks:** Do tasks flow strictly through states (e.g., Todo -> In Progress -> In Review -> Done), or is it customizable per project?

  > **Please select:** [ ] Strict predefined states | [ ] Fully customizable columns/states | [ ] Other

- **GitHub Sync:** When a GitHub issue is closed, does the linked task automatically move to "Done"?
  > **Please select:** [ ] Yes, automatically | [ ] No, manual move required | [ ] Ask user each time

---

### 3. User Roles, Permissions, and Access

**What distinct types/roles of users exist in the system?**

> **Please select or edit:**
>
> - [ ] **Admin/Workspace Owner:** Can manage billing, GitHub integrations, and all projects.
> - [ ] **Member:** Can chat, create/edit tasks, and change views.
> - [ ] **Guest/Viewer:** Can only read tasks and chat in specific assigned channels.
> - [ ] Everyone has identical permissions (flat structure).
> - [ ] Other — please specify: \***\*\*\*\*\***\_\_\***\*\*\*\*\***

**What specific features and data can each role access?**

> **Inferred Answer:** (Pending selection above. Assuming flat structure for v1: all authenticated users can read/write to the board and participate in chat).

**Does authorization depend on complex conditions?**

> **Inferred Answer:** No complex conditions inferred for the MVP. Access is based on workspace/organization membership.

---

### 4. External Integrations (Business Context)

**What external services must the system integrate with to support the user workflow?**

> **Inferred Answer:**
>
> 1. **GitHub API (REST or GraphQL):** For READ access to issues, pull requests, and real-time status updates (webhooks).
> 2. **WebSocket / Real-time Service:** (e.g., Socket.io, Pusher, or Supabase Realtime) for the live chat, online presence, and board syncing.

**What specific business actions trigger a call to these external services?**

> **Inferred Answer:**
>
> - Fetching GitHub status when rendering the task board.
> - Receiving GitHub webhooks when PRs/issues are updated to refresh the UI.
> - Pushing messages and online status updates via WebSockets for the chat panel.

---

### 5. Test Credentials and Setup

_Note: All external API interactions are considered critical to test. The AI must execute real network requests._

**Please provide the necessary Sandbox/Test API keys and connection credentials for all external services:**

> **Action Required:**
> Please provide test credentials for:
>
> 1. A dedicated GitHub fine-grained Personal Access Token (or OAuth App integration setup) with READ permissions for issues and PRs on a test repository.
> 2. A test GitHub repository URL we can use for testing the webhooks and API calls.
>
> _(Note: You do not need to paste them here in the chat. We will save them securely to `.env.test` later. Just confirm if they are available)._
