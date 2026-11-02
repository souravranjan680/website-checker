-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SeoCheckType" ADD VALUE 'NOINDEX';
ALTER TYPE "SeoCheckType" ADD VALUE 'TITLE_LENGTH';
ALTER TYPE "SeoCheckType" ADD VALUE 'META_DESCRIPTION_LENGTH';
ALTER TYPE "SeoCheckType" ADD VALUE 'INVALID_CANONICAL';
ALTER TYPE "SeoCheckType" ADD VALUE 'SKIPPED_HEADING_LEVEL';
ALTER TYPE "SeoCheckType" ADD VALUE 'ROBOTS_BLOCKS_ALL';

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN     "siteChecks" JSONB;

-- AlterTable
ALTER TABLE "ScanPage" ADD COLUMN     "seoData" JSONB;
