import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user: {
      id: string;
      keycloakId: string | null;
      email: string;
      name?: string | null;
      roles: string[];
      permissions: string[];
      passwordChangeRequired?: boolean;
    };
  }

  interface FastifyInstance {
    authenticate: import("fastify").preHandlerHookHandler;
  }
}
