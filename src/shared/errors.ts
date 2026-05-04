import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    const normalizedError = normalizeError(error);

    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => issue.message).join(", ");
      reply.status(400).send({ ok: false, error: message });
      return;
    }

    if (error instanceof HttpError) {
      reply.status(error.statusCode).send({ ok: false, error: error.message });
      return;
    }

    const statusCode = typeof normalizedError.statusCode === "number" ? normalizedError.statusCode : 500;
    const message = statusCode >= 500 ? "Internal server error" : normalizedError.message;
    requestLog(app, normalizedError, statusCode);
    reply.status(statusCode).send({ ok: false, error: message });
  });
}

function normalizeError(error: unknown): Error & { statusCode?: number } {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : "Unknown error");
}

function requestLog(app: FastifyInstance, error: Error, statusCode: number): void {
  if (statusCode >= 500) {
    app.log.error({ err: error }, error.message);
  }
}
