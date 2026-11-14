-- Plan 8.5: when a member accepted the privacy notice at registration.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "privacyAcceptedAt" TIMESTAMP(3);

