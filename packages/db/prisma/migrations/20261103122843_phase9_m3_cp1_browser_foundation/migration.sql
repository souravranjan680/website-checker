-- CreateEnum
CREATE TYPE "BrowserEngine" AS ENUM ('CHROMIUM', 'FIREFOX', 'WEBKIT');

-- CreateEnum
CREATE TYPE "BrowserRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'UNAVAILABLE', 'TIMED_OUT', 'SKIPPED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ScanPage" ADD COLUMN     "compatibility" JSONB;

-- AlterTable
ALTER TABLE "Website" ADD COLUMN     "crossBrowserEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "crossBrowserMobile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "crossBrowserPageLimit" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "crossBrowserTargets" "BrowserEngine"[] DEFAULT ARRAY['FIREFOX', 'WEBKIT']::"BrowserEngine"[];

-- CreateTable
CREATE TABLE "ScanBrowserRun" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "browser" "BrowserEngine" NOT NULL,
    "version" TEXT,
    "status" "BrowserRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "pagesPlanned" INTEGER NOT NULL DEFAULT 0,
    "pagesChecked" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "skippedChecks" JSONB,

    CONSTRAINT "ScanBrowserRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScanBrowserRun_scanId_browser_key" ON "ScanBrowserRun"("scanId", "browser");

-- AddForeignKey
ALTER TABLE "ScanBrowserRun" ADD CONSTRAINT "ScanBrowserRun_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
