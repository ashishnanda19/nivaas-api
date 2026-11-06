-- CreateTable
CREATE TABLE "JobState" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,

    CONSTRAINT "JobState_pkey" PRIMARY KEY ("name")
);
