CREATE UNIQUE INDEX "one_active_order_per_student" ON "ExpectedOrder" ("studentId", "platform", "merchantOrderId") WHERE "status" <> 'CANCELLED';
CREATE UNIQUE INDEX "one_current_credential_per_parcel" ON "Credential" ("parcelId") WHERE "state" = 'ACTIVE';
ALTER TABLE "User" ADD CONSTRAINT "user_role" CHECK ("role" IN ('STUDENT', 'STAFF'));
ALTER TABLE "ExpectedOrder" ADD CONSTRAINT "order_status" CHECK ("status" IN ('PENDING', 'MATCHED', 'CANCELLED'));
ALTER TABLE "ExpectedOrder" ADD CONSTRAINT "order_platform" CHECK ("platform" IN ('AMAZON', 'FLIPKART', 'MYNTRA', 'OTHER'));
ALTER TABLE "Parcel" ADD CONSTRAINT "parcel_status" CHECK ("status" IN ('RECEIVED', 'AWAITING_MATCH', 'AWAITING_COLLECTION', 'CLOSED'));
ALTER TABLE "Parcel" ADD CONSTRAINT "parcel_hold" CHECK ("hold" IN ('NONE', 'REVIEW', 'DISPUTE'));
ALTER TABLE "Parcel" ADD CONSTRAINT "parcel_assignment" CHECK (("orderId" IS NULL) = ("studentId" IS NULL));
ALTER TABLE "Credential" ADD CONSTRAINT "credential_state" CHECK ("state" IN ('ACTIVE', 'EXPIRED', 'INVALIDATED', 'CONSUMED') AND "attempts" BETWEEN 0 AND 5 AND "expiresAt" > "issuedAt");
ALTER TABLE "ParcelIdentifier" ADD CONSTRAINT "identifier_catalog" CHECK (("kind" = 'ORDER_ID' AND "namespace" IN ('AMAZON', 'FLIPKART', 'MYNTRA', 'OTHER')) OR ("kind" = 'TRACKING' AND "namespace" IN ('DELHIVERY', 'BLUEDART', 'EKART', 'OTHER')));
ALTER TABLE "OrderReference" ADD CONSTRAINT "tracking_catalog" CHECK ("namespace" IN ('DELHIVERY', 'BLUEDART', 'EKART', 'OTHER'));
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "delivery_state" CHECK ("state" IN ('PENDING', 'ACCEPTED', 'DELIVERED', 'FAILED'));

CREATE FUNCTION mailroom_retained_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mailroom.reset', true) = 'enabled' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Retained mailroom records are append-only';
END $$;
CREATE TRIGGER "audit_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION mailroom_retained_record();
CREATE TRIGGER "handover_immutable" BEFORE UPDATE OR DELETE ON "Handover" FOR EACH ROW EXECUTE FUNCTION mailroom_retained_record();
CREATE TRIGGER "decision_append_only" BEFORE UPDATE OR DELETE ON "Decision" FOR EACH ROW EXECUTE FUNCTION mailroom_retained_record();
CREATE FUNCTION mailroom_closed_parcel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'CLOSED' AND current_setting('mailroom.reset', true) IS DISTINCT FROM 'enabled' THEN
    RAISE EXCEPTION 'Collected parcel is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER "closed_parcel_immutable" BEFORE UPDATE OR DELETE ON "Parcel" FOR EACH ROW EXECUTE FUNCTION mailroom_closed_parcel();
