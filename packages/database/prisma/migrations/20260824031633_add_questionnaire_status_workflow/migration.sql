/*
  Warnings:

  - Added the required column `updatedAt` to the `questionnaires` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "QuestionnaireStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'SUBMITTED', 'REVIEWED', 'APPROVED');

-- AlterTable
ALTER TABLE "questionnaires" ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "status" "QuestionnaireStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "submittedByUserId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
