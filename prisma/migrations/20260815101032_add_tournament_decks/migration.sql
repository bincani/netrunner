-- CreateTable
CREATE TABLE "TournamentDeck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dateCreation" DATETIME NOT NULL,
    "userName" TEXT NOT NULL,
    "factionCode" TEXT
);

-- CreateTable
CREATE TABLE "TournamentDeckCard" (
    "deckId" INTEGER NOT NULL,
    "cardCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    PRIMARY KEY ("deckId", "cardCode"),
    CONSTRAINT "TournamentDeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "TournamentDeck" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
