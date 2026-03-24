import '@vitest/browser/context';

declare module '@vitest/browser/context' {
  interface BrowserCommands {
    setFixtureState: (payload: { fixtureId?: string; state: unknown }) => Promise<void>;
    getFixtureState: (payload?: { fixtureId?: string }) => Promise<unknown>;
    resetFixtureState: (payload?: { fixtureId?: string }) => Promise<void>;
  }
}
