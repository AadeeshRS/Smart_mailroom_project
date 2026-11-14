-- One Collect now code per member, covering all their parcels waiting in the mailroom (plan W5).
-- The operator verifies the code (PENDING -> VERIFIED), then hands over the parcels they tick.
ALTER TYPE "CollectionStatus" ADD VALUE 'VERIFIED' AFTER 'PENDING';

DROP INDEX "one_pending_collection_per_parcel";
DROP INDEX "one_completed_collection_per_parcel";
ALTER TABLE "Collection" DROP CONSTRAINT "Collection_parcelId_fkey";
ALTER TABLE "Collection" DROP COLUMN "parcelId";

-- One open (PENDING or VERIFIED) code per member. Written without the new enum value, which can't be
-- used in the transaction that adds it.
CREATE UNIQUE INDEX "one_open_collection_per_member" ON "Collection" ("userId")
  WHERE "status" NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED');
