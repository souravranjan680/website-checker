-- CreateEnum
CREATE TYPE "WebsiteComparisonRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'CANCELLING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebsiteComparisonSide" AS ENUM ('REFERENCE', 'TARGET');

-- CreateEnum
CREATE TYPE "WebsiteComparisonPageStatus" AS ENUM ('DISCOVERED', 'CAPTURED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "WebsiteComparison" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "referenceWebsiteId" TEXT NOT NULL,
    "targetWebsiteId" TEXT NOT NULL,
    "maxPages" INTEGER NOT NULL DEFAULT 10,
    "maxDepth" INTEGER NOT NULL DEFAULT 1,
    "includePatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludePatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "viewports" TEXT[] DEFAULT ARRAY['1920x1080']::TEXT[],
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteComparisonRun" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "triggeredById" TEXT,
    "status" "WebsiteComparisonRunStatus" NOT NULL DEFAULT 'QUEUED',
    "activeLock" BOOLEAN DEFAULT true,
    "config" JSONB NOT NULL,
    "jobId" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "referencePages" INTEGER NOT NULL DEFAULT 0,
    "targetPages" INTEGER NOT NULL DEFAULT 0,
    "pagesFailed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "failureCode" TEXT,
    "browserVersion" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteComparisonRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteComparisonPage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "side" "WebsiteComparisonSide" NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "status" "WebsiteComparisonPageStatus" NOT NULL DEFAULT 'DISCOVERED',
    "httpStatus" INTEGER,
    "title" TEXT,
    "loadTimeMs" INTEGER,
    "errorMessage" TEXT,
    "facts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteComparisonPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteComparison_projectId_createdAt_idx" ON "WebsiteComparison"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WebsiteComparison_referenceWebsiteId_idx" ON "WebsiteComparison"("referenceWebsiteId");

-- CreateIndex
CREATE INDEX "WebsiteComparison_targetWebsiteId_idx" ON "WebsiteComparison"("targetWebsiteId");

-- CreateIndex
CREATE INDEX "WebsiteComparisonRun_comparisonId_createdAt_idx" ON "WebsiteComparisonRun"("comparisonId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WebsiteComparisonRun_status_idx" ON "WebsiteComparisonRun"("status");

-- CreateIndex
CREATE INDEX "WebsiteComparisonRun_triggeredById_idx" ON "WebsiteComparisonRun"("triggeredById");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteComparisonRun_comparisonId_activeLock_key" ON "WebsiteComparisonRun"("comparisonId", "activeLock");

-- CreateIndex
CREATE INDEX "WebsiteComparisonPage_runId_side_path_idx" ON "WebsiteComparisonPage"("runId", "side", "path");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteComparisonPage_runId_side_normalizedUrl_key" ON "WebsiteComparisonPage"("runId", "side", "normalizedUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Website_id_projectId_key" ON "Website"("id", "projectId");

-- AddForeignKey
ALTER TABLE "WebsiteComparison" ADD CONSTRAINT "WebsiteComparison_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteComparison" ADD CONSTRAINT "WebsiteComparison_referenceWebsiteId_projectId_fkey" FOREIGN KEY ("referenceWebsiteId", "projectId") REFERENCES "Website"("id", "projectId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WebsiteComparison" ADD CONSTRAINT "WebsiteComparison_targetWebsiteId_projectId_fkey" FOREIGN KEY ("targetWebsiteId", "projectId") REFERENCES "Website"("id", "projectId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WebsiteComparison" ADD CONSTRAINT "WebsiteComparison_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteComparisonRun" ADD CONSTRAINT "WebsiteComparisonRun_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "WebsiteComparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteComparisonRun" ADD CONSTRAINT "WebsiteComparisonRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteComparisonPage" ADD CONSTRAINT "WebsiteComparisonPage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WebsiteComparisonRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
