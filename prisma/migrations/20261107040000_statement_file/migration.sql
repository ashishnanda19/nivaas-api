-- Keep the original bank statement file with its upload
ALTER TABLE "BankStatementUpload" ADD COLUMN "fileKey" TEXT;
