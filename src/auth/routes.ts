import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KeycloakAuthService } from "./keycloak.js";

const emailSchema = z.string().email().transform((value) => value.toLowerCase());

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8),
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional()
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1)
});

export async function registerAuthRoutes(app: FastifyInstance, keycloakAuth: KeycloakAuthService): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const token = await keycloakAuth.register(body);
    reply.status(201);
    return token;
  });

  app.post("/auth/login", async (request) => {
    const body = loginSchema.parse(request.body);
    return keycloakAuth.login(body);
  });

  app.get("/auth/me", { preHandler: app.authenticate }, async (request) => request.user);
}
