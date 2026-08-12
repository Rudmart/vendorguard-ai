import { PrismaClient } from "@prisma/client";

// A single, shared database connection used by the whole app - avoids
// creating a new connection for every request, which would slow things
// down and eventually exhaust the database's connection limit.
export const prisma = new PrismaClient();

export * from "@prisma/client";
