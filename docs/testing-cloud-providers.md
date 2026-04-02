# Testing Cloud Providers

This document defines how Calypso tests cloud-provider integrations such as the
Google Cloud provisioning and deploy flow.

## Goals

- validate our request sequencing, payloads, retries, and error handling
- test against real provider behavior instead of inventing response shapes
- keep CI deterministic and fast
- avoid requiring a live cloud project for every PR

## Source Of Truth

Provider response fixtures should be based on captured real traffic first.

Documentation is secondary:

- use provider docs to discover endpoints, fields, and permission semantics
- use live captures to confirm the actual wire format our code sees
- if docs and live behavior diverge, treat the captured behavior as authoritative
  for tests and document the mismatch

## Strategy

Cloud-provider tests should use three layers.

### 1. Unit tests

Use ordinary unit tests for logic that does not depend on live HTTP:

- credential-source precedence
- request normalization
- permission-decision logic
- CLI flag and environment resolution
- retry and polling state transitions

### 2. Recorded integration tests

Most automated coverage should come from replaying captured provider traffic.

The intended shape is:

- run against a disposable real cloud project in record mode
- capture the exact request and response pairs for the endpoints our code calls
- sanitize secrets and unstable identifiers
- commit the resulting golden fixtures into the repo
- during test runs, intercept outbound provider HTTP and replay those fixtures

This gives realistic provider behavior without requiring live cloud access in CI.

### 3. Live smoke tests

Keep a small number of live cloud tests for end-to-end confidence:

- manual `workflow_dispatch`
- nightly scheduled smoke tests
- disposable environment names and explicit cleanup

Live tests are for confidence, not for the bulk of coverage.

## Recording Real Traces

The preferred implementation is a transport wrapper around all provider HTTP.

Requirements:

- all provider REST calls pass through one internal request function
- the wrapper supports `live`, `record`, and `replay` modes
- `record` mode writes request and response pairs to fixture files
- request keys are normalized by method, URL path, sorted query params, and
  normalized JSON body
- fixtures live under `tests/fixtures/cloud-providers/<provider>/<scenario>/`

Example fixture shape:

```json
{
  "request": {
    "method": "POST",
    "url": "https://alloydb.googleapis.com/v1/projects/example/locations/us-central1/clusters?clusterId=calypso-demo-db",
    "body": {
      "databaseVersion": "POSTGRES_15"
    }
  },
  "response": {
    "status": 200,
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "name": "projects/example/locations/us-central1/operations/op-123"
    }
  }
}
```

## Sanitization Rules

Recorded fixtures must remove or replace secrets and unstable values.

Always redact:

- `Authorization` headers
- OAuth access tokens
- service-account private keys
- database passwords
- SSH keys

Usually sanitize:

- public IPs and private IPs
- service-account emails
- project IDs if the fixture should be reusable
- operation IDs if they are noisy and not asserted directly

Do not remove fields that our code branches on.

## Replay Rules

Tests should not rely on alternate base URLs or feature flags that rewrite
provider endpoints. Instead:

- intercept `fetch` during test execution
- for provider domains, serve the recorded fixture response
- fail fast if an unexpected provider request is made
- fail fast if a fixture is missing

This keeps production URLs and test URLs aligned.

## Scope Of Mocking

We do not need to model an entire cloud provider.

Fixtures only need to preserve the parts our code actually consumes, such as:

- operation names and polling URLs
- `done` or `status`
- `state`
- `error`
- `permissions`
- `ipAddress`
- resource names and self-links

## Updating Fixtures

Refresh recorded fixtures when:

- provider behavior changes in production
- our code starts reading new response fields
- new endpoints are added
- tests reveal an undocumented mismatch between docs and live behavior

When refreshing, prefer replacing the smallest fixture set that covers the new
behavior rather than re-recording everything.

## Current Direction For Google Cloud

For the current Google Cloud feature, the next testing work should be:

1. add a single Google transport wrapper used by all REST calls
2. add record and replay support for that transport
3. capture golden responses from a disposable GCP project
4. add replay-based integration tests for doctor, provision, and deploy flows
5. add one opt-in live smoke workflow

That sequence keeps the test harness grounded in real provider traffic and avoids
guessing at response shapes from documentation alone.
