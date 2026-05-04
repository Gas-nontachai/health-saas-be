import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { prisma } from "./prisma.js";

const config = loadConfig();
const app = await buildApp({ config, prisma });

try {
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}

const shutdown = async (): Promise<void> => {
  await app.close();
  await prisma.$disconnect();
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
