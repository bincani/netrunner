/*
  Warnings:

  - Made the column `userId` on table `Collection` required. This step will fail if there are existing NULL values in that column.
  - Made the column `userId` on table `Deck` required. This step will fail if there are existing NULL values in that column.
  - Made the column `userId` on table `HiddenBuilderPack` required. This step will fail if there are existing NULL values in that column.
  - Made the column `userId` on table `Setting` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Collection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Collection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Collection" ("createdAt", "id", "isDefault", "name", "sortOrder", "updatedAt", "userId") SELECT "createdAt", "id", "isDefault", "name", "sortOrder", "updatedAt", "userId" FROM "Collection";
DROP TABLE "Collection";
ALTER TABLE "new_Collection" RENAME TO "Collection";
CREATE TABLE "new_Deck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "netrunnerdbId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateCreation" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Deck" ("dateCreation", "id", "importedAt", "name", "netrunnerdbId", "sortOrder", "userId", "uuid") SELECT "dateCreation", "id", "importedAt", "name", "netrunnerdbId", "sortOrder", "userId", "uuid" FROM "Deck";
DROP TABLE "Deck";
ALTER TABLE "new_Deck" RENAME TO "Deck";
CREATE UNIQUE INDEX "Deck_userId_netrunnerdbId_key" ON "Deck"("userId", "netrunnerdbId");
CREATE TABLE "new_DeckCard" (
    "deckId" INTEGER NOT NULL,
    "cardCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    PRIMARY KEY ("deckId", "cardCode"),
    CONSTRAINT "DeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DeckCard" ("cardCode", "deckId", "quantity") SELECT "cardCode", "deckId", "quantity" FROM "DeckCard";
DROP TABLE "DeckCard";
ALTER TABLE "new_DeckCard" RENAME TO "DeckCard";
CREATE TABLE "new_HiddenBuilderPack" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "packCode" TEXT NOT NULL,
    CONSTRAINT "HiddenBuilderPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HiddenBuilderPack_packCode_fkey" FOREIGN KEY ("packCode") REFERENCES "Pack" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_HiddenBuilderPack" ("id", "packCode", "userId") SELECT "id", "packCode", "userId" FROM "HiddenBuilderPack";
DROP TABLE "HiddenBuilderPack";
ALTER TABLE "new_HiddenBuilderPack" RENAME TO "HiddenBuilderPack";
CREATE UNIQUE INDEX "HiddenBuilderPack_userId_packCode_key" ON "HiddenBuilderPack"("userId", "packCode");
CREATE TABLE "new_Setting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Setting" ("id", "key", "userId", "value") SELECT "id", "key", "userId", "value" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
CREATE UNIQUE INDEX "Setting_userId_key_key" ON "Setting"("userId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
