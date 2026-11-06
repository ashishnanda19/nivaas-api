-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
ADD COLUMN     "embeddingModel" TEXT;

-- AlterTable
ALTER TABLE "ComplaintLink" ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "score" DOUBLE PRECISION;
