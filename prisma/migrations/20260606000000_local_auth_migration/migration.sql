ALTER TABLE "User"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
  ADD COLUMN "migratedFrom" TEXT,
  ADD COLUMN "migratedAt" TIMESTAMP(3),
  ADD COLUMN "temporaryPasswordSentAt" TIMESTAMP(3);

ALTER TABLE "User"
  ALTER COLUMN "keycloakId" DROP NOT NULL;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");
