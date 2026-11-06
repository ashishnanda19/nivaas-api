-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('BEFORE_DUE', 'ON_DUE', 'OVERDUE');

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "language" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reminder_sentAt_idx" ON "Reminder"("sentAt");

-- CreateIndex
CREATE INDEX "Reminder_flatId_idx" ON "Reminder"("flatId");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_billId_userId_kind_key" ON "Reminder"("billId", "userId", "kind");
