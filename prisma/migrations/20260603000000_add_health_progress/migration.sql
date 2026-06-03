CREATE TABLE "HealthMetricEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthMetricEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HealthGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "startValue" DOUBLE PRECISION NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HealthMetricEntry_userId_metricType_date_key" ON "HealthMetricEntry"("userId", "metricType", "date");

CREATE INDEX "HealthMetricEntry_userId_metricType_date_idx" ON "HealthMetricEntry"("userId", "metricType", "date");

CREATE UNIQUE INDEX "HealthGoal_userId_metricType_key" ON "HealthGoal"("userId", "metricType");

CREATE INDEX "HealthGoal_userId_metricType_idx" ON "HealthGoal"("userId", "metricType");

ALTER TABLE "HealthMetricEntry" ADD CONSTRAINT "HealthMetricEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HealthGoal" ADD CONSTRAINT "HealthGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
