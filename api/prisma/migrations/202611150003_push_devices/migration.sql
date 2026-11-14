-- Phase 6: a push token belongs to the session that registered it; push retries back off; SKIPPED when the
-- member has no device. No token was ever registered before this, so the table is empty.
DELETE FROM "Device";

-- AlterEnum
ALTER TYPE "PushState" ADD VALUE 'SKIPPED';

-- DropForeignKey
ALTER TABLE "Device" DROP CONSTRAINT "Device_userId_fkey";

-- DropIndex
DROP INDEX "Device_userId_idx";

-- AlterTable
ALTER TABLE "Device" DROP COLUMN "userId",
ADD COLUMN     "sessionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "pushAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Device_sessionId_idx" ON "Device"("sessionId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

