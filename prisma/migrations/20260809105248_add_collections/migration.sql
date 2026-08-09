-- CreateTable
CREATE TABLE "Collection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Seed the default collection every existing CollectionEntry row will be backfilled into
INSERT INTO "Collection" ("name", "isDefault", "createdAt", "updatedAt")
VALUES ('My Collection', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CollectionEntry" (
    "collectionId" INTEGER NOT NULL,
    "cardCode" TEXT NOT NULL,
    "quantityOwned" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("collectionId", "cardCode"),
    CONSTRAINT "CollectionEntry_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionEntry_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "Card" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CollectionEntry" ("collectionId", "cardCode", "quantityOwned")
SELECT (SELECT "id" FROM "Collection" WHERE "isDefault" = true LIMIT 1), "cardCode", "quantityOwned" FROM "CollectionEntry";
DROP TABLE "CollectionEntry";
ALTER TABLE "new_CollectionEntry" RENAME TO "CollectionEntry";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
