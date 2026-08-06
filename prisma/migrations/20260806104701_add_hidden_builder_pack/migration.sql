-- CreateTable
CREATE TABLE "HiddenBuilderPack" (
    "packCode" TEXT NOT NULL PRIMARY KEY,
    CONSTRAINT "HiddenBuilderPack_packCode_fkey" FOREIGN KEY ("packCode") REFERENCES "Pack" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
