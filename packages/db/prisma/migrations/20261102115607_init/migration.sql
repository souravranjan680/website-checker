-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ScanMode" AS ENUM ('SINGLE_PAGE', 'URL_LIST', 'CRAWL');

-- CreateEnum
CREATE TYPE "ScanTrigger" AS ENUM ('MANUAL', 'RESCAN', 'SCHEDULED', 'API');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'RUNNING', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('PENDING', 'SCANNING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "IssueCategory" AS ENUM ('ACCESSIBILITY', 'UI_HEALTH', 'RESPONSIVE', 'PERFORMANCE', 'SEO', 'SECURITY');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "DetectionType" AS ENUM ('AUTOMATED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "UiCheckType" AS ENUM ('BROKEN_IMAGE', 'BROKEN_LINK', 'HORIZONTAL_SCROLL', 'CONTENT_OVERFLOW', 'OVERLAPPING_ELEMENTS', 'TEXT_CLIPPING', 'OUT_OF_VIEWPORT', 'FAILED_STYLESHEET', 'FAILED_SCRIPT', 'CONSOLE_ERROR', 'JS_ERROR', 'FAILED_REQUEST', 'EMPTY_BUTTON', 'EMPTY_LINK', 'BROKEN_NAVIGATION', 'IMAGE_SIZING');

-- CreateEnum
CREATE TYPE "SeoCheckType" AS ENUM ('MISSING_TITLE', 'DUPLICATE_TITLE', 'MISSING_META_DESCRIPTION', 'DUPLICATE_META_DESCRIPTION', 'MISSING_H1', 'MULTIPLE_H1', 'MISSING_CANONICAL', 'MISSING_OPEN_GRAPH', 'BROKEN_INTERNAL_LINK', 'MISSING_IMAGE_ALT', 'MISSING_SITEMAP', 'MISSING_ROBOTS_TXT');

-- CreateEnum
CREATE TYPE "SecurityCheckType" AS ENUM ('NO_HTTPS', 'HTTP_NOT_REDIRECTED', 'MIXED_CONTENT', 'MISSING_CSP', 'MISSING_X_CONTENT_TYPE_OPTIONS', 'MISSING_REFERRER_POLICY', 'MISSING_FRAME_PROTECTION', 'MISSING_HSTS', 'INSECURE_COOKIE');

-- CreateEnum
CREATE TYPE "FormFactor" AS ENUM ('DESKTOP', 'MOBILE');

-- CreateEnum
CREATE TYPE "ScreenshotKind" AS ENUM ('PAGE_FULL', 'VIEWPORT', 'ISSUE_CROP', 'BASELINE', 'VISUAL_CURRENT', 'VISUAL_DIFF');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "BugReportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "AiInsightKind" AS ENUM ('EXPLANATION', 'FIX', 'BUG_REPORT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SCAN_COMPLETED', 'SCAN_FAILED', 'REGRESSION_DETECTED', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "Website" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "maxDepth" INTEGER NOT NULL DEFAULT 2,
    "maxPages" INTEGER NOT NULL DEFAULT 20,
    "includePatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludePatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "respectRobotsTxt" BOOLEAN NOT NULL DEFAULT true,
    "responsivePageLimit" INTEGER NOT NULL DEFAULT 3,
    "lighthousePageLimit" INTEGER NOT NULL DEFAULT 1,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationToken" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "authorizationConfirmedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanSchedule" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "triggeredById" TEXT,
    "trigger" "ScanTrigger" NOT NULL DEFAULT 'MANUAL',
    "mode" "ScanMode" NOT NULL DEFAULT 'CRAWL',
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "config" JSONB NOT NULL,
    "jobId" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "pagesScanned" INTEGER NOT NULL DEFAULT 0,
    "pagesFailed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "accessibilityScore" INTEGER,
    "uiHealthScore" INTEGER,
    "performanceScore" INTEGER,
    "seoScore" INTEGER,
    "bestPracticesScore" INTEGER,
    "securityScore" INTEGER,
    "totalIssues" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "highCount" INTEGER NOT NULL DEFAULT 0,
    "mediumCount" INTEGER NOT NULL DEFAULT 0,
    "lowCount" INTEGER NOT NULL DEFAULT 0,
    "infoCount" INTEGER NOT NULL DEFAULT 0,
    "manualChecklist" JSONB,
    "previousScanId" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanPage" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "status" "PageStatus" NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "contentType" TEXT,
    "title" TEXT,
    "metaDescription" TEXT,
    "canonicalUrl" TEXT,
    "language" TEXT,
    "h1Count" INTEGER,
    "loadTimeMs" INTEGER,
    "responseHeaders" JSONB,
    "consoleErrors" JSONB,
    "failedRequests" JSONB,
    "pageErrors" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "scanPageId" TEXT,
    "trackedIssueId" TEXT,
    "category" "IssueCategory" NOT NULL,
    "severity" "Severity" NOT NULL,
    "ruleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pageUrl" TEXT,
    "viewport" TEXT,
    "selector" TEXT,
    "htmlSnippet" TEXT,
    "boundingBox" JSONB,
    "suggestedFix" TEXT,
    "details" JSONB,
    "fingerprint" TEXT NOT NULL,
    "screenshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessibilityIssue" (
    "issueId" TEXT NOT NULL,
    "axeRuleId" TEXT NOT NULL,
    "impact" TEXT,
    "wcagCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wcagLevel" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "helpUrl" TEXT,
    "detection" "DetectionType" NOT NULL DEFAULT 'AUTOMATED',
    "failureSummary" TEXT,

    CONSTRAINT "AccessibilityIssue_pkey" PRIMARY KEY ("issueId")
);

-- CreateTable
CREATE TABLE "UIHealthIssue" (
    "issueId" TEXT NOT NULL,
    "checkType" "UiCheckType" NOT NULL,
    "resourceUrl" TEXT,
    "statusCode" INTEGER,
    "measurements" JSONB,

    CONSTRAINT "UIHealthIssue_pkey" PRIMARY KEY ("issueId")
);

-- CreateTable
CREATE TABLE "SEOIssue" (
    "issueId" TEXT NOT NULL,
    "checkType" "SeoCheckType" NOT NULL,
    "expected" TEXT,
    "actual" TEXT,

    CONSTRAINT "SEOIssue_pkey" PRIMARY KEY ("issueId")
);

-- CreateTable
CREATE TABLE "SecurityIssue" (
    "issueId" TEXT NOT NULL,
    "checkType" "SecurityCheckType" NOT NULL,
    "headerName" TEXT,
    "observedValue" TEXT,
    "recommendedValue" TEXT,

    CONSTRAINT "SecurityIssue_pkey" PRIMARY KEY ("issueId")
);

-- CreateTable
CREATE TABLE "TrackedIssue" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "category" "IssueCategory" NOT NULL,
    "ruleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenScanId" TEXT,
    "lastSeenScanId" TEXT,
    "resolvedInScanId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceResult" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "scanPageId" TEXT NOT NULL,
    "formFactor" "FormFactor" NOT NULL DEFAULT 'MOBILE',
    "performanceScore" INTEGER,
    "accessibilityScore" INTEGER,
    "bestPracticesScore" INTEGER,
    "seoScore" INTEGER,
    "fcpMs" DOUBLE PRECISION,
    "lcpMs" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "inpMs" DOUBLE PRECISION,
    "tbtMs" DOUBLE PRECISION,
    "speedIndexMs" DOUBLE PRECISION,
    "opportunities" JSONB,
    "diagnostics" JSONB,
    "lighthouseVersion" TEXT,
    "rawReportKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screenshot" (
    "id" TEXT NOT NULL,
    "scanId" TEXT,
    "scanPageId" TEXT,
    "kind" "ScreenshotKind" NOT NULL,
    "viewport" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Screenshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualBaseline" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "viewport" TEXT NOT NULL,
    "screenshotId" TEXT NOT NULL,
    "ignoreRegions" JSONB NOT NULL DEFAULT '[]',
    "failPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualComparison" (
    "id" TEXT NOT NULL,
    "baselineId" TEXT NOT NULL,
    "scanId" TEXT,
    "currentScreenshotId" TEXT NOT NULL,
    "diffScreenshotId" TEXT,
    "diffPixels" INTEGER NOT NULL,
    "totalPixels" INTEGER NOT NULL,
    "diffPercent" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "websiteId" TEXT,
    "issueId" TEXT,
    "createdById" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'P3',
    "status" "BugReportStatus" NOT NULL DEFAULT 'OPEN',
    "affectedUrl" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "viewport" TEXT NOT NULL,
    "stepsToReproduce" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedBehavior" TEXT NOT NULL,
    "actualBehavior" TEXT NOT NULL,
    "selector" TEXT,
    "htmlSnippet" TEXT,
    "suggestedFix" TEXT,
    "screenshotId" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInsight" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "kind" "AiInsightKind" NOT NULL,
    "model" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE INDEX "Project_createdById_idx" ON "Project"("createdById");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Website_verificationToken_key" ON "Website"("verificationToken");

-- CreateIndex
CREATE INDEX "Website_hostname_idx" ON "Website"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "Website_projectId_baseUrl_key" ON "Website"("projectId", "baseUrl");

-- CreateIndex
CREATE UNIQUE INDEX "ScanSchedule_websiteId_key" ON "ScanSchedule"("websiteId");

-- CreateIndex
CREATE INDEX "Scan_websiteId_createdAt_idx" ON "Scan"("websiteId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Scan_status_idx" ON "Scan"("status");

-- CreateIndex
CREATE INDEX "Scan_triggeredById_idx" ON "Scan"("triggeredById");

-- CreateIndex
CREATE INDEX "ScanPage_scanId_status_idx" ON "ScanPage"("scanId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScanPage_scanId_normalizedUrl_key" ON "ScanPage"("scanId", "normalizedUrl");

-- CreateIndex
CREATE INDEX "Issue_scanId_category_severity_idx" ON "Issue"("scanId", "category", "severity");

-- CreateIndex
CREATE INDEX "Issue_scanPageId_idx" ON "Issue"("scanPageId");

-- CreateIndex
CREATE INDEX "Issue_trackedIssueId_idx" ON "Issue"("trackedIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_scanId_fingerprint_key" ON "Issue"("scanId", "fingerprint");

-- CreateIndex
CREATE INDEX "AccessibilityIssue_axeRuleId_idx" ON "AccessibilityIssue"("axeRuleId");

-- CreateIndex
CREATE INDEX "UIHealthIssue_checkType_idx" ON "UIHealthIssue"("checkType");

-- CreateIndex
CREATE INDEX "SEOIssue_checkType_idx" ON "SEOIssue"("checkType");

-- CreateIndex
CREATE INDEX "SecurityIssue_checkType_idx" ON "SecurityIssue"("checkType");

-- CreateIndex
CREATE INDEX "TrackedIssue_websiteId_status_idx" ON "TrackedIssue"("websiteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedIssue_websiteId_fingerprint_key" ON "TrackedIssue"("websiteId", "fingerprint");

-- CreateIndex
CREATE INDEX "PerformanceResult_scanId_idx" ON "PerformanceResult"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceResult_scanPageId_formFactor_key" ON "PerformanceResult"("scanPageId", "formFactor");

-- CreateIndex
CREATE UNIQUE INDEX "Screenshot_storageKey_key" ON "Screenshot"("storageKey");

-- CreateIndex
CREATE INDEX "Screenshot_scanId_idx" ON "Screenshot"("scanId");

-- CreateIndex
CREATE INDEX "Screenshot_scanPageId_idx" ON "Screenshot"("scanPageId");

-- CreateIndex
CREATE UNIQUE INDEX "VisualBaseline_screenshotId_key" ON "VisualBaseline"("screenshotId");

-- CreateIndex
CREATE UNIQUE INDEX "VisualBaseline_websiteId_pageUrl_viewport_key" ON "VisualBaseline"("websiteId", "pageUrl", "viewport");

-- CreateIndex
CREATE INDEX "VisualComparison_baselineId_createdAt_idx" ON "VisualComparison"("baselineId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BugReport_projectId_createdAt_idx" ON "BugReport"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BugReport_issueId_idx" ON "BugReport"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "AiInsight_issueId_kind_key" ON "AiInsight"("issueId", "kind");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "ActivityLog_projectId_createdAt_idx" ON "ActivityLog"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanSchedule" ADD CONSTRAINT "ScanSchedule_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_previousScanId_fkey" FOREIGN KEY ("previousScanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanPage" ADD CONSTRAINT "ScanPage_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_scanPageId_fkey" FOREIGN KEY ("scanPageId") REFERENCES "ScanPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_trackedIssueId_fkey" FOREIGN KEY ("trackedIssueId") REFERENCES "TrackedIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "Screenshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessibilityIssue" ADD CONSTRAINT "AccessibilityIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UIHealthIssue" ADD CONSTRAINT "UIHealthIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SEOIssue" ADD CONSTRAINT "SEOIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIssue" ADD CONSTRAINT "SecurityIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedIssue" ADD CONSTRAINT "TrackedIssue_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedIssue" ADD CONSTRAINT "TrackedIssue_firstSeenScanId_fkey" FOREIGN KEY ("firstSeenScanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedIssue" ADD CONSTRAINT "TrackedIssue_lastSeenScanId_fkey" FOREIGN KEY ("lastSeenScanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedIssue" ADD CONSTRAINT "TrackedIssue_resolvedInScanId_fkey" FOREIGN KEY ("resolvedInScanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceResult" ADD CONSTRAINT "PerformanceResult_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceResult" ADD CONSTRAINT "PerformanceResult_scanPageId_fkey" FOREIGN KEY ("scanPageId") REFERENCES "ScanPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screenshot" ADD CONSTRAINT "Screenshot_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screenshot" ADD CONSTRAINT "Screenshot_scanPageId_fkey" FOREIGN KEY ("scanPageId") REFERENCES "ScanPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualBaseline" ADD CONSTRAINT "VisualBaseline_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualBaseline" ADD CONSTRAINT "VisualBaseline_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "Screenshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualBaseline" ADD CONSTRAINT "VisualBaseline_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualComparison" ADD CONSTRAINT "VisualComparison_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "VisualBaseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualComparison" ADD CONSTRAINT "VisualComparison_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualComparison" ADD CONSTRAINT "VisualComparison_currentScreenshotId_fkey" FOREIGN KEY ("currentScreenshotId") REFERENCES "Screenshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualComparison" ADD CONSTRAINT "VisualComparison_diffScreenshotId_fkey" FOREIGN KEY ("diffScreenshotId") REFERENCES "Screenshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "Screenshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInsight" ADD CONSTRAINT "AiInsight_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInsight" ADD CONSTRAINT "AiInsight_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
