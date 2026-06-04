# API Changelog

## 2026-06-04 — Backup Center API

### What Changed

- Added scheduled backup endpoint `POST /internal/backup/run` protected by `x-backup-secret`.
- Added backoffice backup endpoints `POST /backoffice/backups/run` and `GET /backoffice/backups`.
- Added `BackupLog` persistence for `running`, `success`, and `failed` backup history.
- Backup runs create `database.sql`, `database.xlsx`, `manifest.json`, zip the files, upload the zip to a private Supabase Storage bucket, and cleanup temporary files.
- Added RBAC permissions `backups.create.system` and `backups.read.system`.
- Excel backup uses explicit column whitelists and excludes sensitive token/password/secret fields.
- `GET /backoffice/backups` supports page/limit scroll fetch with `status` and `triggerType` filters.
- Added optional `BACKUP_PG_DUMP_PATH` so environments can point backup SQL export at an absolute `pg_dump` binary path.

### Why It Changed

System owners need automated database backup that supports real restore through SQL dump and readable admin inspection through Excel, while giving backoffice users visibility into backup history.

### Breaking or Non-Breaking

- **Non-breaking:** existing auth, health, dashboard, export, and backoffice role/user endpoints are unchanged.
- Existing Admin roles receive the new backup permissions after the RBAC catalog sync runs.

### Frontend Actions Required

- Add a Backup Center page that calls `GET /backoffice/backups?page=1&limit=20` and loads more pages while `page * limit < total`.
- Show status, trigger type, file name, file size, started/finished timestamps, and error message.
- Gate the manual backup button with `backups.create.system`; call `POST /backoffice/backups/run` when clicked.
- Cron integration should call `POST /internal/backup/run` with `x-backup-secret`; do not send the secret in query string.

### Migration and Compatibility Notes

- Apply Prisma migration `20260607000000_add_backup_logs` before enabling backup APIs.
- Configure `BACKUP_CRON_SECRET`, `BACKUP_TEMP_DIR`, `BACKUP_ENVIRONMENT`, optional `BACKUP_PG_DUMP_PATH`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_BACKUP_BUCKET`.
- Runtime must include `pg_dump`; container or Render environments may need `postgresql-client`. If `pg_dump` is installed outside PATH, set `BACKUP_PG_DUMP_PATH` to its absolute path.
- External drive backup upload is removed; do not configure drive service account secrets for Backup Center.
- Supabase Storage bucket must be private. The service role key is backend-only and must never be exposed to frontend clients.
- Backward compatibility is preserved because backup routes use the existing no-`/api/v1` route style.

## 2026-06-04 — Local Auth Migration and Force Password Change

### What Changed

- Auth runtime moved from Keycloak token proxy/JWKS verification to backend-issued local JWTs.
- `POST /auth/register`, `POST /auth/login`, and `POST /auth/refresh` now return local token responses with `requiresPasswordChange` and `user`.
- Added `POST /auth/password/change-required` for migrated users who must replace temporary passwords after first login.
- Protected APIs return `403` with `PASSWORD_CHANGE_REQUIRED` when a user has not completed the required password change.
- User records now store local auth fields while preserving optional legacy `keycloakId` for migration mapping.
- Deploy startup now runs `npm run deploy:migrate`, which applies Prisma migrations, syncs RBAC, and optionally imports Keycloak users.

### Why It Changed

The MVP no longer needs Keycloak as a runtime dependency. Local auth reduces infrastructure cost and allows migrated users to enter the app with temporary passwords while forcing a secure first-login password change.

### Breaking or Non-Breaking

- **Breaking for auth integration:** frontend must treat backend tokens as the only supported runtime tokens and read `requiresPasswordChange` from login/refresh responses.
- **Non-breaking for health/dashboard/export APIs:** endpoint paths and response payloads remain unchanged, except protected APIs can now return `PASSWORD_CHANGE_REQUIRED`.

### Frontend Actions Required

- Store `access_token` and `refresh_token` from backend auth responses as before, but stop assuming Keycloak-only fields such as `id_token`, `session_state`, or `scope`.
- If login/refresh returns `requiresPasswordChange=true`, redirect to the password-change page immediately.
- When any protected API returns `{ "ok": false, "error": "PASSWORD_CHANGE_REQUIRED" }`, redirect to the password-change page.
- Call `POST /auth/password/change-required` with current temporary password and new password, then let the user continue after success.

### Migration and Compatibility Notes

- Existing `User.keycloakId` values are preserved as optional legacy IDs for import mapping.
- Keycloak user import only runs when `KEYCLOAK_USER_MIGRATION_ON_DEPLOY=true`.
- The import is idempotent: users are matched by legacy `keycloakId` or email, default roles/profile are ensured, and temporary password emails are not resent unless `KEYCLOAK_USER_MIGRATION_FORCE_EMAIL=true`.
- Temporary passwords are sent via SMTP and are not logged.
