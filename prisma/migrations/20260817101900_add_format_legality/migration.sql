-- AlterTable
ALTER TABLE "Card" ADD COLUMN "cardId" TEXT;

-- CreateTable
CREATE TABLE "Format" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "CardFormatLegality" (
    "cardCode" TEXT NOT NULL,
    "formatCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,

    PRIMARY KEY ("cardCode", "formatCode"),
    CONSTRAINT "CardFormatLegality_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "Card" ("code") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CardFormatLegality_formatCode_fkey" FOREIGN KEY ("formatCode") REFERENCES "Format" ("code") ON DELETE CASCADE ON UPDATE CASCADE
);
