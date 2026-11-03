-- CreateEnum
CREATE TYPE "FunctionalCheckType" AS ENUM ('CONTROL_NO_EFFECT', 'LAYER_CLIPPED', 'LAYER_OCCLUDED', 'LAYER_BLANK_AREA', 'LAYER_NOT_DISMISSIBLE', 'ESCAPE_NOT_SUPPORTED', 'TAB_PANEL_NOT_SHOWN', 'INTERACTION_ERROR', 'BROKEN_ANCHOR', 'NAV_CURRENT_MISMATCH');

-- AlterEnum
ALTER TYPE "IssueCategory" ADD VALUE 'FUNCTIONAL';

-- AlterTable
ALTER TABLE "ScanPage" ADD COLUMN     "exploration" JSONB;

-- AlterTable
ALTER TABLE "Website" ADD COLUMN     "explorationControlLimit" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "explorationEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "explorationPageLimit" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "FunctionalIssue" (
    "issueId" TEXT NOT NULL,
    "checkType" "FunctionalCheckType" NOT NULL,
    "controlName" TEXT,
    "controlRole" TEXT,
    "controlSelector" TEXT,
    "interaction" JSONB,

    CONSTRAINT "FunctionalIssue_pkey" PRIMARY KEY ("issueId")
);

-- CreateIndex
CREATE INDEX "FunctionalIssue_checkType_idx" ON "FunctionalIssue"("checkType");

-- AddForeignKey
ALTER TABLE "FunctionalIssue" ADD CONSTRAINT "FunctionalIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
