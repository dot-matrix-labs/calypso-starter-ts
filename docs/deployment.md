# Deployment Posture
Target Environment: Bare metal deployment targeting Linux natively. Docker is strictly avoided.

1. **System Service Engine:** `systemd` will keep the application alive natively.
2. **Environment Variables:** Handled via `.env` files.
3. **HTTP Server:** Bun handles server APIs and serves the static frontend assets from `apps/web/dist`.
