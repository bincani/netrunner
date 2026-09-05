/*
  Warnings:

  - The primary key for the `HiddenBuilderPack` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Setting` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `id` to the `HiddenBuilderPack` table without a default value. This is not possible if the table is not empty.
  - Added the required column `id` to the `Setting` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "SyncCheckpoint" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HiddenBuilderPack" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "packCode" TEXT NOT NULL,
    CONSTRAINT "HiddenBuilderPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HiddenBuilderPack_packCode_fkey" FOREIGN KEY ("packCode") REFERENCES "Pack" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_HiddenBuilderPack" ("packCode") SELECT "packCode" FROM "HiddenBuilderPack";
DROP TABLE "HiddenBuilderPack";
ALTER TABLE "new_HiddenBuilderPack" RENAME TO "HiddenBuilderPack";
CREATE UNIQUE INDEX "HiddenBuilderPack_userId_packCode_key" ON "HiddenBuilderPack"("userId", "packCode");
CREATE TABLE "new_Setting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Setting" ("key", "value") SELECT "key", "value" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
CREATE UNIQUE INDEX "Setting_userId_key_key" ON "Setting"("userId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
