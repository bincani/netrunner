-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "expectedCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "elapsedMs" INTEGER NOT NULL DEFAULT 0,
    "lastResumedAt" DATETIME
);

-- CreateTable
CREATE TABLE "BatchCard" (
    "batchId" INTEGER NOT NULL,
    "cardCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    PRIMARY KEY ("batchId", "cardCode"),
    CONSTRAINT "BatchCard_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BatchCard_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "Card" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
