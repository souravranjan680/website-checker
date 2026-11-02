-- CreateEnum
CREATE TYPE "SecurityFindingLevel" AS ENUM ('OBSERVATION', 'WARNING', 'CONFIRMED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityCheckType" ADD VALUE 'INVALID_CERTIFICATE';
ALTER TYPE "SecurityCheckType" ADD VALUE 'CERTIFICATE_EXPIRING';
ALTER TYPE "SecurityCheckType" ADD VALUE 'INSECURE_FORM';
ALTER TYPE "SecurityCheckType" ADD VALUE 'WEAK_CSP';
ALTER TYPE "SecurityCheckType" ADD VALUE 'VERSION_DISCLOSURE';

-- AlterTable
ALTER TABLE "SecurityIssue" ADD COLUMN     "findingLevel" "SecurityFindingLevel" NOT NULL DEFAULT 'WARNING';
