# Calypso Weekly: Initial Agent Prompt

> **Context:** This prompt is designed to be fed to a Calypso-compliant AI software engineering agent alongside the core `scaffold-task.md` instruction set. It incorporates "Known Traps" to ensure a flawless, zero-shot initialization.

---

**Role:** You are an elite AI software engineer executing the Calypso Blueprint.
**Task:** Scaffold and build the Prototype for "Calypso Weekly"

I am building a web application for Substack publishers. I want to provide journalists with a way to easily create a weekly recap newsletter using a modern, clean WYSIWYG interface. 

**Core Product Features:**
1. **Feeds Sidebar:** The app will fetch and parse public RSS feeds from Yahoo News and Bloomberg. The journalist can toggle between these feeds, view headlines/snippets, and search the feed text.
2. **Draft Editor:** A text area where the journalist writes their weekly synopsis.
3. **Curation:** The journalist can click to select/add up to 5 articles from the sidebar into their draft.
4. **Export:** A button that generates a clean, inline-styled HTML block containing the synopsis and the selected articles, which is copied to the clipboard for pasting into Substack.

**Technical Architecture (Strict Calypso Adherence):**
* **Monorepo:** Use `bun` workspaces. `/apps/web` (React/Vite/Tailwind), `/apps/server` (Bun native API), `/packages/core` (Shared Types).
* **Backend:** Expose a `/api/feeds?source=...` endpoint. Use a lightweight XML parser (e.g., `rss-parser`) to safely normalize the Yahoo/Bloomberg RSS feeds into a standard `Article` TypeScript interface. The server must serve the built React app statically.
* **Frontend:** Build a responsive split-pane layout using Tailwind CSS. Use React state to manage the selected articles and the synopsis. No external UI component libraries are allowed (No Bootstrap, no shadcn).

**⚠️ Agent Survival Guide (Known Calypso Traps):**
1. **No JS Configs:** Scaffolding tools (Vite/ESLint) generate `.js` or `.mjs` configs. Delete them immediately and write them in pure `.ts`.
2. **PostCSS:** Do not use an external `postcss.config.ts`. Inline your Tailwind plugins directly into your `vite.config.ts` inside a `css.postcss` block to avoid ESM module crashes.
3. **No Emit:** Never let `tsc` dump JavaScript files into the repo. Ensure `"noEmit": true` is set in the `tsconfig.json` for all internal `/packages/*`.
4. **SPA Routing:** Your Bun server must check if static assets exist (`Bun.file.exists()`) before blindly falling back to returning `index.html`.
5. **Headless Testing:** Disable Playwright's auto-opening HTML reporter (`reporter: [['html', { open: 'never' }]]`) so it does not freeze your terminal session if a test fails.

Begin by executing the Calypso Setup & Architecture scaffold phases, verifying your tests locally before proceeding to prototype the RSS integration and React layout!
