-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "accessPrivilege" INTEGER,
ADD COLUMN     "businessCriticality" INTEGER,
ADD COLUMN     "dataSensitivity" INTEGER,
ADD COLUMN     "fourthPartyConcentration" INTEGER,
ADD COLUMN     "geographicRegulatoryExposure" INTEGER,
ADD COLUMN     "operationalDependency" INTEGER;
