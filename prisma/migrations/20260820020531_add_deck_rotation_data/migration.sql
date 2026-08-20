-- AlterTable
ALTER TABLE "Deck" ADD COLUMN "dateCreation" DATETIME;

-- AlterTable
ALTER TABLE "Format" ADD COLUMN "activeRestrictionName" TEXT;
ALTER TABLE "Format" ADD COLUMN "currentSnapshotDate" TEXT;
