-- Gate 8 / TKT-806 (DEC-020, D6): problem reports about a final result. Enum values in their own
-- migration as usual.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESULT_PROBLEM_RESOLVED';
CREATE TYPE "ResultProblemStatus" AS ENUM ('OPEN', 'RESOLVED');
