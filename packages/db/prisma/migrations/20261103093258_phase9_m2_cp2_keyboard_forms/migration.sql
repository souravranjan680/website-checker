-- CreateEnum
CREATE TYPE "FormProbeMode" AS ENUM ('OFF', 'STATIC', 'BLUR', 'SYNTHETIC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FunctionalCheckType" ADD VALUE 'FOCUS_NOT_VISIBLE';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'FOCUS_ON_HIDDEN';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'FOCUS_LOST';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'KEYBOARD_TRAP';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'KEY_ACTIVATION_FAILED';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'CLICK_NOT_FOCUSABLE';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'FORM_REQUIRED_NOT_INDICATED';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'FORM_INDICATOR_WITHOUT_REQUIRED';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'FORM_DESCRIBEDBY_MISSING';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'FORM_PLACEHOLDER_ONLY_LABEL';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'FORM_ERROR_NOT_ASSOCIATED';
ALTER TYPE "FunctionalCheckType" ADD VALUE 'FORM_NO_BLUR_FEEDBACK';

-- AlterTable
ALTER TABLE "Website" ADD COLUMN     "formProbeMode" "FormProbeMode" NOT NULL DEFAULT 'BLUR',
ADD COLUMN     "keyboardProbeEnabled" BOOLEAN NOT NULL DEFAULT true;
