-- The admin dashboard counts parcels received and collected on a given day (plan 7.1).
CREATE INDEX "Parcel_receivedAt_idx" ON "Parcel"("receivedAt");
CREATE INDEX "Parcel_collectedAt_idx" ON "Parcel"("collectedAt");
