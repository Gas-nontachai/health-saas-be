DROP INDEX IF EXISTS "User_keycloakId_key";

ALTER TABLE "User" DROP COLUMN IF EXISTS "keycloakId";
