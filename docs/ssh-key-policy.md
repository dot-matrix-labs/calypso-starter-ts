# SSH Key Policy

This document defines how Calypso handles SSH credentials for provisioning and
deployment automation.

## Goals

- keep private SSH keys in the secret manager or local operator environment
- avoid writing private keys to disk in CI
- avoid multiple competing credential input methods
- make local and CI SSH behavior explicit

## Policy

Calypso prefers `ssh-agent` for non-interactive automation.

That means:

- CI stores the private key in the platform secret store
- CI loads the key into `ssh-agent`
- Calypso scripts use the ambient SSH agent via `SSH_AUTH_SOCK`
- the scripts do not accept raw private-key contents as an environment variable
- CI does not need to create a temporary private-key file before running the
  Google Cloud scripts

## CI Rules

For GitHub Actions and other automation:

- store the SSH private key in secrets such as `DEPLOY_SSH_KEY`
- start `ssh-agent` in the job
- load the secret with `ssh-add -`
- pass `SSH_AUTH_SOCK` through to any script that needs SSH

The private key remains in the secret manager and in agent memory for the life
of the job.

## Local Rules

For local developer use:

- a normal SSH agent is preferred when available
- `CALYPSO_SSH_PRIVATE_KEY_FILE` remains the explicit manual fallback when an
  agent is not available
- the fallback exists for local operations, not as the primary automation path

## Script Contract

The current order of SSH auth resolution is:

1. ambient `ssh-agent`
2. explicit `CALYPSO_SSH_PRIVATE_KEY_FILE` local fallback

There is one obvious primary path for automation: `ssh-agent`.

## Operational Notes

- `ssh` works with identity files or an SSH agent; it does not consume a raw
  private key string directly as an identity source
- provisioning needs a public key to place on the VM, so the scripts resolve
  that from the loaded agent identity or from the fallback key file
- using `ssh-agent` is preferred over temporary files when minimizing on-disk
  secret exposure matters
