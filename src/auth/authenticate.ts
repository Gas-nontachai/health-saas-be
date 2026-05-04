import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AppConfig } from "../config.js";
import type { AppPrisma } from "../prisma.js";
import { HttpError } from "../shared/errors.js";

type KeycloakPayload = JWTPayload & {
  email?: string;
  name?: string;
  preferred_username?: string;
};

export function createAuthenticate(config: AppConfig, prisma: AppPrisma): preHandlerHookHandler {
  const jwks = createRemoteJWKSet(new URL(config.KEYCLOAK_JWKS_URL));

  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new HttpError(401, "Missing bearer token");
    }

    const token = authHeader.slice("Bearer ".length);
    let payload: KeycloakPayload;

    try {
      const verified = await jwtVerify(token, jwks, {
        issuer: config.KEYCLOAK_ISSUER,
        audience: config.KEYCLOAK_AUDIENCE
      });
      payload = verified.payload as KeycloakPayload;
    } catch {
      throw new HttpError(401, "Invalid bearer token");
    }

    if (!payload.sub) {
      throw new HttpError(401, "Token is missing subject");
    }

    const email = payload.email ?? `${payload.sub}@keycloak.local`;
    const name = payload.name ?? payload.preferred_username ?? null;

    const user = await prisma.user.upsert({
      where: { keycloakId: payload.sub },
      update: {},
      create: {
        keycloakId: payload.sub,
        email,
        name,
        profile: {
          create: {}
        }
      }
    });

    request.user = {
      id: user.id,
      keycloakId: user.keycloakId,
      email: user.email,
      name: user.name
    };
  };
}
