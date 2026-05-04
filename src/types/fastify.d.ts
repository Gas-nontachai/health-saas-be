import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user: {
      id: string;
      keycloakId: string;
      email: string;
      name?: string | null;
    };
  }

  interface FastifyInstance {
    authenticate: import("fastify").preHandlerHookHandler;
  }
}
