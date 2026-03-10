# Product Requirements Document (PRD)

## 1. Product Vision & Value Proposition

**Core Problem Solved:** Eliminates the need for teams to switch context between separate chat apps (like Slack), task trackers (like Jira/Asana), and code repositories (GitHub). It centralizes communication and project tracking in one unified interface.

**Value Proposition:** Provides tight, side-by-side integration of real-time chat and multi-view project management, deeply linked with live GitHub status. The user experience must be exceptionally graceful, prioritizing a beautiful, smooth, and highly responsive UI over raw feature density.

**Successful Outcome:** A user can view their tasks in their preferred layout, instantly see if a blocking GitHub PR is merged, and ping a teammate about it without ever leaving the dashboard.

## 2. Core Workflows & User Stories

**Primary "Happy Path" Workflow:**
1. User logs in and connects their GitHub account.
2. User sees the main dashboard elegantly split into the Project Board (left 3/4) and Chat (right 1/4).
3. User creates a new task on the board in List or Kanban view. The task includes standard semantic fields: **Priority, Estimate Start, Estimated Deliver, Depends On, Name, Description, and Owner**.
4. A 2-way sync occurs: Creating or updating the task on the dashboard automatically creates/updates the corresponding GitHub issue, and vice-versa.
5. In the chat window, a user clicks on an online colleague's avatar to instantly navigate to exactly what that person is currently looking at on the project board (Group or DM context).
6. As users manipulate tasks (e.g. associating predefined organization tags or arbitrary filter tags), the UI updates instantly for everyone.

**Edge Cases & Alternative Workflows:**
* A user wants to view the Gantt chart to adjust dependent task timelines (`Depends On`, `Estimate Start`, `Estimated Deliver`) when a GitHub PR is delayed. The system syncs these date updates back.
* A slash command fails (e.g., trying to assign an invalid user or repository), and the system responds with a graceful, helpful error message.
* Merge conflicts: If a GitHub issue is updated simultaneously to a dashboard task edit, the system gracefully resolves or surfaces the discrepancy.

**Task Entity Model:**
Tasks possess standard app defaults with specific semantics that drive the three views (List, Kanban, Gantt).
* **Required Fields:** Name, Description, Owner, Priority.
* **Scheduling Fields:** Estimate Start, Estimated Deliver, Depends On (powers Gantt).
* **Taxonomy:** Key-value pairs with pre-fixed organization options (dropdowns) plus the ability to attach arbitrary tags for custom filtering.
* **GitHub Sync:** Full READ/WRITE sync at the prototype phase. Any state change on the board pushes to GitHub; any GitHub webhook triggers a board update.

## 3. UI/UX & Design Philosophy

**Design Goal:** A "graceful feeling product."
* **Fluid Layout:** The 3/4 (board) to 1/4 (chat) split should feel natural, with smooth, performant resizing or collapsing if needed.
* **Contextual Presence Navigation:** Clicking a user's avatar in the chat instantly jumps your 3/4 board view to exactly match what that user is currently seeing/working on.
* **Micro-Interactions:** Subtle animations for task movements, chat bubble appearances, and status updates to make the application feel alive and responsive.
* **Clutter-Free Interface:** Emphasize whitespace, clear typography, and a modern color palette to avoid the overwhelming density of traditional project management tools.

## 4. User Roles, Permissions, and Access

* **Admin/Workspace Owner:** Can manage billing, GitHub integrations, and all projects.
* **Member:** Can chat, create/edit tasks, and change views.
* **Guest/Viewer:** Can only read tasks and chat in specific assigned channels.

## 5. External Integrations (Business Context)

* **GitHub API (GraphQL preferred for efficiency):** For READ access to issues, pull requests, and real-time status updates (webhooks). Future iterations will support WRITE access.
* **WebSocket / Real-time Service (e.g., Supabase Realtime, Socket.io):** Powers the live chat, online presence indicators, and instant board syncing to ensure the UI always reflects the current state without manual refreshes.

## 6. Constraints & Technical Assumptions

* **Authentication:** Requires secure OAuth flow for both the application platform and the GitHub integration.
* **Performance:** Real-time sync and complex views (like the Gantt chart) must be optimized to prevent browser lag, ensuring the graceful UX is maintained.
* **Test Credentials:** Requires a dedicated GitHub fine-grained Personal Access Token with READ permissions for issues and PRs on a test repository to build the automated fixture generator. (Pending).
