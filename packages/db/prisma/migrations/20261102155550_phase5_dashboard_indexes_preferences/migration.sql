-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationPreferences" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE INDEX "Scan_createdAt_idx" ON "Scan"("createdAt");

-- CreateIndex
CREATE INDEX "TrackedIssue_websiteId_firstSeenAt_idx" ON "TrackedIssue"("websiteId", "firstSeenAt");

-- CreateIndex
CREATE INDEX "TrackedIssue_websiteId_resolvedAt_idx" ON "TrackedIssue"("websiteId", "resolvedAt");
