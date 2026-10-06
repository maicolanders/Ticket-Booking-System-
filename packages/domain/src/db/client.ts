import { PrismaClient } from '@prisma/client';

// One client per process. Reused across dev hot-reloads (tsx watch, vitest)
// so reloading a module never opens a second connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
