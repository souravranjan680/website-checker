-- CreateEnum
CREATE TYPE "VisualComparisonStatus" AS ENUM ('UNCHANGED', 'MINOR', 'CHANGED');

-- AlterTable
ALTER TABLE "VisualComparison" ADD COLUMN     "details" JSONB,
ADD COLUMN     "status" "VisualComparisonStatus" NOT NULL DEFAULT 'UNCHANGED';
