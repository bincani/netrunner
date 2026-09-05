PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Deck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "netrunnerdbId" INTEGER NOT NULL,
    "userId" INTEGER,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateCreation" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Deck" ("id", "netrunnerdbId", "userId", "uuid", "name", "importedAt", "dateCreation", "sortOrder")
SELECT "id", "id", NULL, "uuid", "name", "importedAt", "dateCreation", "sortOrder" FROM "Deck";
DROP TABLE "Deck";
ALTER TABLE "new_Deck" RENAME TO "Deck";
CREATE UNIQUE INDEX "Deck_userId_netrunnerdbId_key" ON "Deck"("userId", "netrunnerdbId");

CREATE TABLE "new_DeckCard" (
    "deckId" INTEGER NOT NULL,
    "cardCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    PRIMARY KEY ("deckId", "cardCode"),
    CONSTRAINT "DeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeckCard_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "Card" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DeckCard" ("deckId", "cardCode", "quantity")
SELECT "deckId", "cardCode", "quantity" FROM "DeckCard";
DROP TABLE "DeckCard";
ALTER TABLE "new_DeckCard" RENAME TO "DeckCard";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
