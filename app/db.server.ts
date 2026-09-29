import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
  // eslint-disable-next-line no-var
  var authLocksGlobal: PrismaClient;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

// Lock waiters must not consume the pool needed by the lock holder.
export const authLockDb = global.authLocksGlobal ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.authLocksGlobal = authLockDb;

export default prisma;
