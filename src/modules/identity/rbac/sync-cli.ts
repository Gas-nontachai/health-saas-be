import { prisma } from "../../../infra/prisma.js";
import { syncPermissions } from "./sync.js";

try {
  const result = await syncPermissions(prisma);
  console.log(`Synced ${result.permissions} permissions`);
} finally {
  await prisma.$disconnect();
}
