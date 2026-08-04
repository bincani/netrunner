-- CreateTable
CREATE TABLE "Cycle" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Pack" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "cycleCode" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "size" INTEGER,
    "dateRelease" TEXT,
    CONSTRAINT "Pack_cycleCode_fkey" FOREIGN KEY ("cycleCode") REFERENCES "Cycle" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Faction" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sideCode" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "CardType" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sideCode" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Card" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL,
    "factionCode" TEXT NOT NULL,
    "packCode" TEXT NOT NULL,
    "sideCode" TEXT NOT NULL,
    "cost" INTEGER,
    "factionCost" INTEGER,
    "text" TEXT,
    "deckLimit" INTEGER,
    "keywords" TEXT,
    "strength" INTEGER,
    "uniqueness" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    CONSTRAINT "Card_typeCode_fkey" FOREIGN KEY ("typeCode") REFERENCES "CardType" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Card_factionCode_fkey" FOREIGN KEY ("factionCode") REFERENCES "Faction" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Card_packCode_fkey" FOREIGN KEY ("packCode") REFERENCES "Pack" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionEntry" (
    "cardCode" TEXT NOT NULL PRIMARY KEY,
    "quantityOwned" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CollectionEntry_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "Card" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
