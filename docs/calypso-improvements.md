# Proposed Improvements to Calypso Documentation

Based on the friction points encountered during the scaffolding and prototyping of a strict, "hyper-minimalist" Calypso monorepo, the following additions should be made to the `calypso-blueprint.md` or the `scaffold-task.md` documentation to ensure zero-shot success for AI agents.

## 1. The Javascript Configuration Trap
**Issue:** The blueprint mandates 100% TypeScript. However, CLI init tools (e.g., `eslint --init`, Vite scaffolding) generate `.js` or `.mjs` files by default. Attempting to blindly rename them to `.ts` causes transpilation and ESM resolution errors (especially when `ts-node` is missing or misconfigured).
**Proposed Blueprint Addition:**
* Explicitly state: "Audit all scaffolding tool output. Delete any `.js` or `.mjs` configuration files (`eslint.config.mjs`, `tailwind.config.js`)."
* **PostCSS Rule:** "Do NOT use a separate `postcss.config.ts`. Inline your Tailwind plugins directly into your `vite.config.ts` under the `css.postcss` block. This prevents Vite from crashing while trying to execute separate external TypeScript configuration files."

## 2. Preventing TypeScript Emission Pollution
**Issue:** When setting up build scripts for internal monorepo packages (e.g., `packages/core`), running `tsc` will dump compiled `.js` sibling files directly next to the source files, polluting the codebase.
**Proposed Blueprint Addition:**
* Explicitly state: "Internal packages must be compiled by the target bundler (Vite or Bun). Their local `tsconfig.json` files must exclusively be used for type-checking. Enforce `"noEmit": true` in all package `tsconfig.json` files."

## 3. Bun Native SPA Routing
**Issue:** When the Bun backend server is instructed to serve an E2E testing stub for a React application, simply returning `index.html` for every route breaks the application because the browser cannot load the bundled `.js` and `.css` assets.
**Proposed Blueprint Addition:**
* Provide the canonical snippet for serving a Vite SPA via Bun:
  ```typescript
  // 1. Serve static assets requested by Vite if they exist
  const staticFilePath = `../web/dist${url.pathname === '/' ? '/index.html' : url.pathname}`;
  const file = Bun.file(staticFilePath);
  if (await file.exists()) {
    return new Response(file);
  }

  // 2. Fallback to index.html for client-side React Router
  return new Response(Bun.file("../web/dist/index.html"));
  ```

## 4. Playwright Headless Output Freezing
**Issue:** Playwright is configured by default to aggressively open a Chromium window displaying an HTML test report whenever an assertion fails. In an agentic, terminal-first environment, this locks up the background process entirely or opens useless windows on the host machine.
**Proposed Blueprint Addition:**
* In the Testing Foundation section, dictate: "You must configure Playwright's reporter to NEVER open the HTML report automatically. Add `reporter: [['html', { open: 'never' }]]` to `playwright.config.ts`."
