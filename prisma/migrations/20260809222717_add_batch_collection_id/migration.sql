-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Batch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "collectionId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "expectedCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "elapsedMs" INTEGER NOT NULL DEFAULT 0,
    "lastResumedAt" DATETIME,
    CONSTRAINT "Batch_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Batch" ("id", "collectionId", "name", "expectedCount", "status", "startedAt", "elapsedMs", "lastResumedAt")
SELECT "id", (SELECT "id" FROM "Collection" WHERE "isDefault" = true LIMIT 1), "name", "expectedCount", "status", "startedAt", "elapsedMs", "lastResumedAt" FROM "Batch";
DROP TABLE "Batch";
ALTER TABLE "new_Batch" RENAME TO "Batch";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

