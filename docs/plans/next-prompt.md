# Next Prompt

## Context

The repo now sources the canonical blueprint docs from the `./calypso-blueprint`
git submodule while `.github/workflows/` and `agent-context/workflows/` remain
localized workflow trees. CI workflow drift has already been corrected, and
the flaky StudioChat component test no longer depends on one shared
fixture-state reset across files.

The remaining next priority is the failing Studio API integration suite
reported by the push hooks.

## Next Action

Read these files first:

1. `apps/server/tests/integration/studio-api.test.ts`
2. `apps/server/src/api/studio.ts`
3. `apps/server/src/studio/agent.ts`
4. `docs/plans/implementation-plan.md`
5. this file

Then do this next:

1. Reproduce the failing Studio API integration tests.
2. Determine whether each failure is in the tests or the implementation.
3. Fix them without weakening coverage.
4. After the Studio API suite is green, reconcile the remaining implementation companions to the current workflow YAMLs and release-gate model.

After editing, update `docs/plans/implementation-plan.md` and overwrite this file with the next self-contained prompt.

---

## FAILING TESTS — Must be addressed before next push

The following tests were failing at the time of the last push.
They must be **checked, fixed, or rewritten. Never ignore or skip them.**

```
 FAIL |server|  tests/integration/task-write-boundary.test.ts [ apps/server/tests/integration/task-write-boundary.test.ts ]
```

For each failure: determine whether the test is wrong (fix the test to match
correct behaviour) or the implementation is wrong (fix the code). Do not
disable, comment out, or add skip/todo markers to avoid addressing failures.

---

## FAILING TESTS — Must be addressed before next push

The following tests were failing at the time of the last push.
They must be **checked, fixed, or rewritten. Never ignore or skip them.**

```
   × Studio API integration > GET /studio/status returns inactive when .studio is absent 35ms
   × Studio API integration > GET /studio/status returns session metadata when .studio is present 11ms
   × Studio API integration > POST /studio/chat returns 403 when studio mode is inactive 225ms
   × Studio API integration > POST /studio/chat returns 400 when message is missing 56ms
   × Studio API integration > POST /studio/chat preserves prior turns across a multi-turn session 2ms
   × Studio API integration > POST /studio/reset clears prior session context 2ms
   × Studio API integration > POST /studio/rollback returns 400 when hash is missing 3ms
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > GET /studio/status returns inactive when .studio is absent
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > GET /studio/status returns session metadata when .studio is present
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > POST /studio/chat returns 403 when studio mode is inactive
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > POST /studio/chat returns 400 when message is missing
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > POST /studio/chat preserves prior turns across a multi-turn session
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > POST /studio/reset clears prior session context
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > POST /studio/rollback returns 400 when hash is missing
```

For each failure: determine whether the test is wrong (fix the test to match
correct behaviour) or the implementation is wrong (fix the code). Do not
disable, comment out, or add skip/todo markers to avoid addressing failures.

---

## FAILING TESTS — Must be addressed before next push

The following tests were failing at the time of the last push.
They must be **checked, fixed, or rewritten. Never ignore or skip them.**

```
   × Studio API integration > GET /studio/status returns inactive when .studio is absent 28ms
   × Studio API integration > GET /studio/status returns session metadata when .studio is present 11ms
   × Studio API integration > POST /studio/chat returns 403 when studio mode is inactive 174ms
   × Studio API integration > POST /studio/chat returns 400 when message is missing 2ms
   × Studio API integration > POST /studio/chat preserves prior turns across a multi-turn session 1ms
   × Studio API integration > POST /studio/reset clears prior session context 1ms
   × Studio API integration > POST /studio/rollback returns 400 when hash is missing 1ms
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > GET /studio/status returns inactive when .studio is absent
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > GET /studio/status returns session metadata when .studio is present
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > POST /studio/chat returns 403 when studio mode is inactive
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > POST /studio/chat returns 400 when message is missing
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > POST /studio/chat preserves prior turns across a multi-turn session
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > POST /studio/reset clears prior session context
 FAIL |server|  tests/integration/studio-api.test.ts > Studio API integration > POST /studio/rollback returns 400 when hash is missing
```

For each failure: determine whether the test is wrong (fix the test to match
correct behaviour) or the implementation is wrong (fix the code). Do not
disable, comment out, or add skip/todo markers to avoid addressing failures.

---

## FAILING TESTS — Must be addressed before next push

The following tests were failing at the time of the last push.
They must be **checked, fixed, or rewritten. Never ignore or skip them.**

```
 FAIL |server|  tests/integration/task-write-boundary.test.ts [ apps/server/tests/integration/task-write-boundary.test.ts ]
```

For each failure: determine whether the test is wrong (fix the test to match
correct behaviour) or the implementation is wrong (fix the code). Do not
disable, comment out, or add skip/todo markers to avoid addressing failures.
