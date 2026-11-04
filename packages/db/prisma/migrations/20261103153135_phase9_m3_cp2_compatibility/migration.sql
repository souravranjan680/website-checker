-- CreateEnum
CREATE TYPE "CompatibilityCheckType" AS ENUM ('BROWSER_ONLY_ERROR', 'BROWSER_ONLY_RESOURCE_FAILURE', 'BROWSER_ONLY_FONT_FAILURE', 'BROWSER_ONLY_LAYOUT', 'BROWSER_ONLY_ACCESSIBILITY', 'UNSUPPORTED_CSS');

-- AlterEnum
ALTER TYPE "IssueCategory" ADD VALUE 'COMPATIBILITY';

-- CreateTable
CREATE TABLE "CompatibilityIssue" (
    "issueId" TEXT NOT NULL,
    "browser" "BrowserEngine" NOT NULL,
    "browserVersion" TEXT NOT NULL,
    "baselineVersion" TEXT NOT NULL,
    "checkType" "CompatibilityCheckType" NOT NULL,
    "matchMethod" TEXT,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "CompatibilityIssue_pkey" PRIMARY KEY ("issueId")
);

-- CreateIndex
CREATE INDEX "CompatibilityIssue_browser_checkType_idx" ON "CompatibilityIssue"("browser", "checkType");

-- AddForeignKey
ALTER TABLE "CompatibilityIssue" ADD CONSTRAINT "CompatibilityIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
