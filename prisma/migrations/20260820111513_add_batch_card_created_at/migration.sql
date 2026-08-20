-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BatchCard" (
    "batchId" INTEGER NOT NULL,
    "cardCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("batchId", "cardCode"),
    CONSTRAINT "BatchCard_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BatchCard_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "Card" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BatchCard" ("batchId", "cardCode", "quantity") SELECT "batchId", "cardCode", "quantity" FROM "BatchCard";
DROP TABLE "BatchCard";
ALTER TABLE "new_BatchCard" RENAME TO "BatchCard";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
