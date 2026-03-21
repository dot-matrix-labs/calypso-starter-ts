# Nightly Container Sanity Workflow

## What it is

A GitHub Actions workflow that runs on a daily schedule, pulls the latest published container
image, and runs a smoke test against it. On failure, it automatically opens a GitHub issue.

## Why it's needed

A published container image can become broken between releases without anyone noticing:

- Base image security patches can change runtime behaviour.
- Package registry changes can affect builds.
- Infrastructure drift can cause the latest image to fail on the current cluster config.

A nightly sanity check catches these regressions before users encounter them.

## Workflow file

`.github/workflows/container-nightly.yml`

```yaml
on:
  schedule:
    - cron: '0 4 * * *' # 04:00 UTC daily
  workflow_dispatch: # allow manual trigger

jobs:
  nightly-sanity:
    runs-on: ubuntu-latest
    steps:
      - name: Pull latest image
        run: docker pull ghcr.io/${{ github.repository }}:latest

      - name: Start container
        run: docker run -d --name calypso-nightly -p 3000:3000 \
          -e DATABASE_URL=... \
          -e JWT_SECRET=test-secret \
          ghcr.io/${{ github.repository }}:latest

      - name: Wait for health
        run: |
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000/healthz && exit 0
            sleep 1
          done
          exit 1

      - name: Smoke test
        run: |
          # Login
          TOKEN=$(curl -sf -X POST http://localhost:3000/api/auth/login \
            -H 'Content-Type: application/json' \
            -d '{"email":"superuser@test","password":"test"}' | jq -r .token)
          # List tasks
          curl -sf http://localhost:3000/api/tasks \
            -H "Authorization: Bearer $TOKEN"

      - name: Open failure issue
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const issues = await github.rest.issues.listForRepo({
              owner: context.repo.owner, repo: context.repo.repo,
              labels: 'nightly-failure', state: 'open'
            });
            if (issues.data.length === 0) {
              await github.rest.issues.create({
                owner: context.repo.owner, repo: context.repo.repo,
                title: 'Nightly container sanity check failed',
                labels: ['nightly-failure'],
                body: `Run: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
              });
            }
```

## Failure deduplication

The "open failure issue" step checks for an existing open issue tagged `nightly-failure`
before creating a new one. Running the nightly workflow multiple times while a failure
persists produces only one open issue.

## Manual trigger

`workflow_dispatch` allows the workflow to be triggered manually from the GitHub Actions UI
or via:

```bash
gh workflow run container-nightly.yml --repo dot-matrix-labs/calypso-starter-ts
```

## Dependencies

- **Docker containerisation** (`docs/docker-containerisation.md`) — image must exist.
- **CI release pipeline hardening** (`docs/ci-release-hardening.md`) — `GET /healthz` must
  exist.

## Source reference (rinzler)

`.github/workflows/container-nightly.yml` — adapt, remove rinzler-specific smoke test steps.
