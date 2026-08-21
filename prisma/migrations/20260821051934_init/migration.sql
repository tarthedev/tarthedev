-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('COUNT', 'CURRENCY', 'PERCENT', 'RATIO');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GoalScope" AS ENUM ('PERSONAL', 'STORE');

-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('DRAFT', 'PROCESSING', 'NEEDS_REVIEW', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "ObservationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CONFLICT', 'UNMAPPED');

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('SCREENSHOT_EXTRACTION', 'COACH_BRIEF', 'CHAT', 'DEEP_ANALYSIS');

-- CreateEnum
CREATE TYPE "ExtractionStrategy" AS ENUM ('STANDARD', 'EXPLICIT', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ShiftKind" AS ENUM ('WORK', 'OFF', 'PTO', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "BriefKind" AS ENUM ('DAILY_BRIEF', 'DEEP_ANALYSIS');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "AggregationMode" AS ENUM ('LATEST', 'SUM');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    "onboardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_definitions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unitType" "UnitType" NOT NULL DEFAULT 'COUNT',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "aggregation" "AggregationMode" NOT NULL DEFAULT 'LATEST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "periodType" "PeriodType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "minimumValue" DOUBLE PRECISION,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "stretchValue" DOUBLE PRECISION,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "scope" "GoalScope" NOT NULL DEFAULT 'PERSONAL',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportingPeriodStart" DATE,
    "reportingPeriodEnd" DATE,
    "periodDetected" BOOLEAN NOT NULL DEFAULT false,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'DRAFT',
    "extractionModel" TEXT,
    "extractionPromptVersion" TEXT,
    "overallConfidence" DOUBLE PRECISION,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "rawExtraction" JSONB,
    "errorMessage" TEXT,
    "notes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_images" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshot_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_observations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "kpiId" TEXT,
    "rawLabel" TEXT NOT NULL,
    "rawValue" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unit" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceImageId" TEXT,
    "status" "ObservationStatus" NOT NULL DEFAULT 'PENDING',
    "aiValue" DOUBLE PRECISION,
    "correctedValue" DOUBLE PRECISION,
    "correctedAt" TIMESTAMP(3),
    "isCorrected" BOOLEAN NOT NULL DEFAULT false,
    "conflictKey" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_attempts" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "strategy" "ExtractionStrategy" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "rawResponse" JSONB,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "model" TEXT NOT NULL,
    "promptVersion" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "snapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_briefs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "BriefKind" NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "dataFingerprint" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "coach_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "contextUsed" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "ShiftKind" NOT NULL DEFAULT 'WORK',
    "hours" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "meta" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "kpi_definitions_userId_active_sortOrder_idx" ON "kpi_definitions"("userId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_definitions_userId_key_key" ON "kpi_definitions"("userId", "key");

-- CreateIndex
CREATE INDEX "goals_userId_active_periodStart_periodEnd_idx" ON "goals"("userId", "active", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "goals_kpiId_periodStart_idx" ON "goals"("kpiId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "goals_userId_kpiId_periodType_periodStart_scope_key" ON "goals"("userId", "kpiId", "periodType", "periodStart", "scope");

-- CreateIndex
CREATE INDEX "snapshots_userId_capturedAt_idx" ON "snapshots"("userId", "capturedAt");

-- CreateIndex
CREATE INDEX "snapshots_userId_status_idx" ON "snapshots"("userId", "status");

-- CreateIndex
CREATE INDEX "snapshots_userId_reportingPeriodStart_reportingPeriodEnd_idx" ON "snapshots"("userId", "reportingPeriodStart", "reportingPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_images_storageKey_key" ON "snapshot_images"("storageKey");

-- CreateIndex
CREATE INDEX "snapshot_images_snapshotId_orderIndex_idx" ON "snapshot_images"("snapshotId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_images_snapshotId_label_key" ON "snapshot_images"("snapshotId", "label");

-- CreateIndex
CREATE INDEX "metric_observations_userId_kpiId_effectiveAt_idx" ON "metric_observations"("userId", "kpiId", "effectiveAt");

-- CreateIndex
CREATE INDEX "metric_observations_userId_status_idx" ON "metric_observations"("userId", "status");

-- CreateIndex
CREATE INDEX "metric_observations_snapshotId_idx" ON "metric_observations"("snapshotId");

-- CreateIndex
CREATE INDEX "metric_observations_userId_periodStart_periodEnd_idx" ON "metric_observations"("userId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "extraction_attempts_snapshotId_idx" ON "extraction_attempts"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_attempts_snapshotId_attemptNumber_key" ON "extraction_attempts"("snapshotId", "attemptNumber");

-- CreateIndex
CREATE INDEX "ai_requests_userId_createdAt_idx" ON "ai_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_requests_userId_feature_createdAt_idx" ON "ai_requests"("userId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "ai_requests_userId_model_createdAt_idx" ON "ai_requests"("userId", "model", "createdAt");

-- CreateIndex
CREATE INDEX "coach_briefs_userId_generatedAt_idx" ON "coach_briefs"("userId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "coach_briefs_userId_kind_cacheKey_key" ON "coach_briefs"("userId", "kind", "cacheKey");

-- CreateIndex
CREATE INDEX "chat_messages_userId_createdAt_idx" ON "chat_messages"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "shifts_userId_date_idx" ON "shifts"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_userId_date_key" ON "shifts"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_userId_key_key" ON "app_settings"("userId", "key");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "event_logs_userId_createdAt_idx" ON "event_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "event_logs_level_createdAt_idx" ON "event_logs"("level", "createdAt");

-- CreateIndex
CREATE INDEX "event_logs_category_createdAt_idx" ON "event_logs"("category", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_definitions" ADD CONSTRAINT "kpi_definitions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpi_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_images" ADD CONSTRAINT "snapshot_images_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpi_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_sourceImageId_fkey" FOREIGN KEY ("sourceImageId") REFERENCES "snapshot_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_attempts" ADD CONSTRAINT "extraction_attempts_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_briefs" ADD CONSTRAINT "coach_briefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
