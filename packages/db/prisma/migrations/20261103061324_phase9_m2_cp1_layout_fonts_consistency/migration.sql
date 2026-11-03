-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UiCheckType" ADD VALUE 'TEXT_OVERFLOW_VISIBLE';
ALTER TYPE "UiCheckType" ADD VALUE 'TEXT_OVERLAP';
ALTER TYPE "UiCheckType" ADD VALUE 'FIXED_OUT_OF_VIEWPORT';
ALTER TYPE "UiCheckType" ADD VALUE 'CONTROL_LABEL_CLIPPED';
ALTER TYPE "UiCheckType" ADD VALUE 'FONT_LOAD_FAILED';
ALTER TYPE "UiCheckType" ADD VALUE 'FONT_FALLBACK_RENDERED';
ALTER TYPE "UiCheckType" ADD VALUE 'ICON_BROKEN';
ALTER TYPE "UiCheckType" ADD VALUE 'ICON_MISSING';
ALTER TYPE "UiCheckType" ADD VALUE 'COMPONENT_INCONSISTENT';

-- AlterTable
ALTER TABLE "ScanPage" ADD COLUMN     "components" JSONB;

-- AlterTable
ALTER TABLE "Website" ADD COLUMN     "consistencyEnabled" BOOLEAN NOT NULL DEFAULT true;
