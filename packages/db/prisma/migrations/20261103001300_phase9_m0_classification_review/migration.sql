-- CreateEnum
CREATE TYPE "FindingClassification" AS ENUM ('DETECTED', 'POTENTIAL_DEFECT', 'OBSERVATION', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('UNREVIEWED', 'CONFIRMED', 'INTENTIONAL');

-- AlterTable
ALTER TABLE "AiInsight" ADD COLUMN     "promptVersion" TEXT NOT NULL DEFAULT 'issue-explain/v1';

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "classification" "FindingClassification" NOT NULL DEFAULT 'INCONCLUSIVE';

-- AlterTable
ALTER TABLE "TrackedIssue" ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- CreateTable
CREATE TABLE "IssueReview" (
    "id" TEXT NOT NULL,
    "trackedIssueId" TEXT NOT NULL,
    "userId" TEXT,
    "fromStatus" "IssueStatus",
    "toStatus" "IssueStatus",
    "fromReview" "ReviewStatus",
    "toReview" "ReviewStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueReview_trackedIssueId_createdAt_idx" ON "IssueReview"("trackedIssueId", "createdAt");

-- AddForeignKey
ALTER TABLE "TrackedIssue" ADD CONSTRAINT "TrackedIssue_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueReview" ADD CONSTRAINT "IssueReview_trackedIssueId_fkey" FOREIGN KEY ("trackedIssueId") REFERENCES "TrackedIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueReview" ADD CONSTRAINT "IssueReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: classify existing issues with the same rules the scanner now uses
-- (apps/scanner/src/issues.ts classifyDraft). Every existing row gets a value.
-- ---------------------------------------------------------------------------

-- Accessibility: axe violation = DETECTED, "needs review" = INCONCLUSIVE.
UPDATE "Issue" i SET "classification" =
  CASE a."detection" WHEN 'AUTOMATED' THEN 'DETECTED'::"FindingClassification"
                     ELSE 'INCONCLUSIVE'::"FindingClassification" END
FROM "AccessibilityIssue" a WHERE a."issueId" = i."id";

-- Security finding levels.
UPDATE "Issue" i SET "classification" =
  CASE s."findingLevel" WHEN 'CONFIRMED' THEN 'DETECTED'::"FindingClassification"
                        WHEN 'WARNING' THEN 'POTENTIAL_DEFECT'::"FindingClassification"
                        ELSE 'OBSERVATION'::"FindingClassification" END
FROM "SecurityIssue" s WHERE s."issueId" = i."id";

-- SEO rule checks and performance (lab) findings.
UPDATE "Issue" SET "classification" = 'DETECTED' WHERE "category" = 'SEO';
UPDATE "Issue" SET "classification" = 'POTENTIAL_DEFECT' WHERE "category" = 'PERFORMANCE';

-- UI health and responsive checks.
UPDATE "Issue" i SET "classification" =
  CASE
    WHEN u."checkType" IN ('HORIZONTAL_SCROLL', 'EMPTY_BUTTON', 'EMPTY_LINK')
      THEN 'DETECTED'::"FindingClassification"
    WHEN u."checkType" IN ('BROKEN_IMAGE', 'BROKEN_LINK', 'FAILED_STYLESHEET', 'FAILED_SCRIPT', 'FAILED_REQUEST')
      THEN CASE WHEN u."measurements"->>'verdict' = 'CONFIRMED'
                THEN 'DETECTED'::"FindingClassification"
                ELSE 'POTENTIAL_DEFECT'::"FindingClassification" END
    WHEN u."checkType" IN ('CONSOLE_ERROR', 'JS_ERROR')
      THEN CASE WHEN u."measurements"->>'kind' IN ('THIRD_PARTY', 'NETWORK')
                THEN 'OBSERVATION'::"FindingClassification"
                ELSE 'POTENTIAL_DEFECT'::"FindingClassification" END
    ELSE 'POTENTIAL_DEFECT'::"FindingClassification"
  END
FROM "UIHealthIssue" u WHERE u."issueId" = i."id";

-- Any other issue (none expected): heuristic evidence.
UPDATE "Issue" SET "classification" = 'POTENTIAL_DEFECT'
WHERE "classification" = 'INCONCLUSIVE'
  AND "category" IN ('UI_HEALTH', 'RESPONSIVE')
  AND NOT EXISTS (SELECT 1 FROM "UIHealthIssue" u WHERE u."issueId" = "Issue"."id");

-- ---------------------------------------------------------------------------
-- Review history is append-only. The only allowed change is clearing userId
-- (ON DELETE SET NULL when a user account is deleted). Deletes happen only
-- through the cascade from TrackedIssue (website deleted).
-- ---------------------------------------------------------------------------
CREATE FUNCTION "issue_review_append_only"() RETURNS trigger AS $$
BEGIN
  IF (NEW."id", NEW."trackedIssueId", NEW."fromStatus", NEW."toStatus", NEW."fromReview",
      NEW."toReview", NEW."note", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."trackedIssueId", OLD."fromStatus", OLD."toStatus", OLD."fromReview",
      OLD."toReview", OLD."note", OLD."createdAt")
     OR (NEW."userId" IS NOT NULL AND NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    RAISE EXCEPTION 'IssueReview rows are append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "issue_review_append_only"
BEFORE UPDATE ON "IssueReview"
FOR EACH ROW EXECUTE FUNCTION "issue_review_append_only"();
