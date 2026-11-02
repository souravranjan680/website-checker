-- CreateEnum
CREATE TYPE "NotificationEmailStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailError" TEXT,
ADD COLUMN     "emailStatus" "NotificationEmailStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN     "emailedAt" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB;

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);
