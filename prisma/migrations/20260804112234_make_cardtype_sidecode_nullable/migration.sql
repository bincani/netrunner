-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CardType" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sideCode" TEXT
);
INSERT INTO "new_CardType" ("code", "name", "sideCode") SELECT "code", "name", "sideCode" FROM "CardType";
DROP TABLE "CardType";
ALTER TABLE "new_CardType" RENAME TO "CardType";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
