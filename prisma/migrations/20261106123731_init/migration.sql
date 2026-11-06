-- CreateEnum
CREATE TYPE "Role" AS ENUM ('RESIDENT', 'HELPDESK', 'COMMITTEE', 'GUARD', 'ADMIN');

-- CreateEnum
CREATE TYPE "MemberRelation" AS ENUM ('OWNER', 'FAMILY', 'TENANT');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('BILL', 'PAYMENT', 'LATE_FEE', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('DUE', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "PayMode" AS ENUM ('UPI', 'CARD', 'NETBANKING', 'CHEQUE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "PaySource" AS ENUM ('TEST_GATEWAY', 'BANK_CSV');

-- CreateEnum
CREATE TYPE "PayStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PARSED', 'FAILED');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('EXACT', 'LIKELY', 'UNCLEAR');

-- CreateEnum
CREATE TYPE "RowState" AS ENUM ('PENDING', 'POSTED', 'QUEUED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('PLUMBING', 'ELECTRICAL', 'LIFT', 'SECURITY', 'HOUSEKEEPING', 'PARKING', 'NOISE', 'WATER_SUPPLY', 'GARDEN', 'OTHER');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED');

-- CreateEnum
CREATE TYPE "VisitorStatus" AS ENUM ('WAITING', 'APPROVED', 'DENIED', 'CHECKED_IN', 'CHECKED_OUT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Society" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratePaisePerSqft" INTEGER NOT NULL DEFAULT 650,
    "graceDays" INTEGER NOT NULL DEFAULT 5,
    "lateFeeMode" TEXT NOT NULL DEFAULT 'MONTHLY_INTEREST',
    "lateFeeFlatPaise" INTEGER NOT NULL DEFAULT 0,
    "lateFeeMonthlyBp" INTEGER NOT NULL DEFAULT 175,

    CONSTRAINT "Society_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tower" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,

    CONSTRAINT "Tower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flat" (
    "id" TEXT NOT NULL,
    "towerId" TEXT NOT NULL,
    "towerNo" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "areaSqft" INTEGER NOT NULL,

    CONSTRAINT "Flat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "title" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "consentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlatMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "relation" "MemberRelation" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FlatMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Otp" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "areaSqft" INTEGER NOT NULL,
    "ratePaise" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'DUE',
    "lateFeePostedPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "flatId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "runningBalancePaise" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "period" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "mode" "PayMode" NOT NULL,
    "reference" TEXT NOT NULL,
    "upiId" TEXT,
    "source" "PaySource" NOT NULL,
    "status" "PayStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementUpload" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PARSED',
    "parseErrors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementRow" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "narration" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "upiId" TEXT,
    "payerName" TEXT,
    "suggestedFlatId" TEXT,
    "confidence" "Confidence" NOT NULL,
    "label" TEXT,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "state" "RowState" NOT NULL DEFAULT 'PENDING',
    "matchedFlatId" TEXT,
    "postedBy" TEXT,
    "postedAt" TIMESTAMP(3),
    "paymentId" TEXT,

    CONSTRAINT "BankStatementRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnownPayer" (
    "id" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "upiId" TEXT,
    "payerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnownPayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "towerNo" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "photoPath" TEXT,
    "category" "Category" NOT NULL,
    "urgency" "Urgency" NOT NULL,
    "aiCategory" "Category" NOT NULL,
    "aiUrgency" "Urgency" NOT NULL,
    "aiReason" TEXT NOT NULL DEFAULT '',
    "aiSource" TEXT NOT NULL DEFAULT 'rules',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" TEXT,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'NEW',
    "responseDueAt" TIMESTAMP(3) NOT NULL,
    "firstResponseAt" TIMESTAMP(3),
    "overdueAt" TIMESTAMP(3),
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalatedReason" TEXT,
    "rating" INTEGER,
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintUpdate" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "staff" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintLink" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "skills" "Category"[],
    "isDutyManager" BOOLEAN NOT NULL DEFAULT false,
    "openLoad" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "gateId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "photoPath" TEXT,
    "photoDeleteAfter" TIMESTAMP(3),
    "status" "VisitorStatus" NOT NULL DEFAULT 'WAITING',
    "source" TEXT NOT NULL DEFAULT 'guard',
    "createdOffline" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreApproval" (
    "id" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "codeHash" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amenity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" TEXT[],
    "feePaise" INTEGER NOT NULL,
    "feeNote" TEXT NOT NULL DEFAULT '',
    "slotMinutes" INTEGER NOT NULL,
    "openFrom" TEXT NOT NULL,
    "openTo" TEXT NOT NULL,

    CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmenityBooking" (
    "id" TEXT NOT NULL,
    "amenityId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "feePaise" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmenityBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "detail" TEXT NOT NULL DEFAULT '',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tower_societyId_number_key" ON "Tower"("societyId", "number");

-- CreateIndex
CREATE INDEX "Flat_towerNo_idx" ON "Flat"("towerNo");

-- CreateIndex
CREATE UNIQUE INDEX "Flat_towerNo_number_key" ON "Flat"("towerNo", "number");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "FlatMember_flatId_idx" ON "FlatMember"("flatId");

-- CreateIndex
CREATE UNIQUE INDEX "FlatMember_userId_flatId_key" ON "FlatMember"("userId", "flatId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "Otp_phone_createdAt_idx" ON "Otp"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "Bill_period_idx" ON "Bill"("period");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_flatId_period_key" ON "Bill"("flatId", "period");

-- CreateIndex
CREATE INDEX "LedgerEntry_flatId_seq_idx" ON "LedgerEntry"("flatId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_flatId_ref_key" ON "LedgerEntry"("flatId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_flatId_idx" ON "Payment"("flatId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_number_key" ON "Receipt"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementRow_paymentId_key" ON "BankStatementRow"("paymentId");

-- CreateIndex
CREATE INDEX "BankStatementRow_uploadId_idx" ON "BankStatementRow"("uploadId");

-- CreateIndex
CREATE INDEX "BankStatementRow_reference_idx" ON "BankStatementRow"("reference");

-- CreateIndex
CREATE INDEX "KnownPayer_upiId_idx" ON "KnownPayer"("upiId");

-- CreateIndex
CREATE UNIQUE INDEX "KnownPayer_flatId_upiId_key" ON "KnownPayer"("flatId", "upiId");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_code_key" ON "Complaint"("code");

-- CreateIndex
CREATE INDEX "Complaint_flatId_idx" ON "Complaint"("flatId");

-- CreateIndex
CREATE INDEX "Complaint_status_idx" ON "Complaint"("status");

-- CreateIndex
CREATE INDEX "Complaint_towerNo_category_createdAt_idx" ON "Complaint"("towerNo", "category", "createdAt");

-- CreateIndex
CREATE INDEX "ComplaintUpdate_complaintId_idx" ON "ComplaintUpdate"("complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplaintLink_childId_key" ON "ComplaintLink"("childId");

-- CreateIndex
CREATE INDEX "ComplaintLink_parentId_idx" ON "ComplaintLink"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_userId_key" ON "StaffMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_clientId_key" ON "Visitor"("clientId");

-- CreateIndex
CREATE INDEX "Visitor_flatId_createdAt_idx" ON "Visitor"("flatId", "createdAt");

-- CreateIndex
CREATE INDEX "Visitor_photoDeleteAfter_idx" ON "Visitor"("photoDeleteAfter");

-- CreateIndex
CREATE UNIQUE INDEX "PreApproval_codeHash_key" ON "PreApproval"("codeHash");

-- CreateIndex
CREATE INDEX "AmenityBooking_amenityId_startsAt_idx" ON "AmenityBooking"("amenityId", "startsAt");

-- CreateIndex
CREATE INDEX "AmenityBooking_flatId_idx" ON "AmenityBooking"("flatId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "Tower" ADD CONSTRAINT "Tower_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flat" ADD CONSTRAINT "Flat_towerId_fkey" FOREIGN KEY ("towerId") REFERENCES "Tower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlatMember" ADD CONSTRAINT "FlatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlatMember" ADD CONSTRAINT "FlatMember_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementRow" ADD CONSTRAINT "BankStatementRow_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "BankStatementUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementRow" ADD CONSTRAINT "BankStatementRow_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownPayer" ADD CONSTRAINT "KnownPayer_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintUpdate" ADD CONSTRAINT "ComplaintUpdate_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "Gate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreApproval" ADD CONSTRAINT "PreApproval_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prevent overlapping confirmed bookings for the same amenity at the database level.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "AmenityBooking"
  ADD CONSTRAINT "AmenityBooking_no_overlap"
  EXCLUDE USING gist (
    "amenityId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" = 'CONFIRMED');

-- Ledger is append-only: block UPDATE and DELETE.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LedgerEntry_no_update" BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
