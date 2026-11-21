import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError, z } from "zod";
import {
  ApiError,
  balances,
  createDebt,
  createInput,
  disputeInput,
  transition,
  visible,
  type Identity,
} from "./domain.js";
import type { Store } from "./store.js";
import type { Auth } from "./auth.js";
import { personInput, vaultInput, memberInput } from "./directory.js";
import { uuidInput } from "./validation.js";
export async function buildApp(options: {
  store: Store;
  auth: Auth;
  demo?: boolean;
  origins?: string[];
  logger?: boolean;
}) {
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
          ],
        }
      : false,
    bodyLimit: 8192,
    requestTimeout: 10000,
  });
  await app.register(cors, {
    origin: options.origins ?? [
      "http://localhost:5173",
      "http://localhost:8081",
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError)
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message } });
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
      });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({
      error: {
        code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message:
          status === 500
            ? "An internal error occurred."
            : (error as Error).message,
      },
    });
  });
  app.get("/health", async () => ({
    status: "ok",
    mode: options.demo ? "local-demo" : "production",
    storage: options.demo ? "ephemeral-memory" : "postgres",
  }));
  app.addHook("onClose", async () => options.store.close());
  async function identity(
    authorization: string | undefined,
  ): Promise<Identity> {
    if (!authorization?.startsWith("Bearer "))
      throw new ApiError(401, "UNAUTHORIZED", "Bearer token required.");
    return options.auth(authorization.slice(7));
  }
  app.get("/v1/me", async (req) => identity(req.headers.authorization));
  app.get("/v1/debts", async (req) => {
    const u = await identity(req.headers.authorization);
    return {
      debts: (await options.store.listFor(u)).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    };
  });
  app.post("/v1/debts", async (req, reply) => {
    const u = await identity(req.headers.authorization);
    const input = createInput.parse(req.body);
    const result = { debt: await options.store.create(createDebt(input, u)) };
    return reply.code(201).send(result);
  });
  for (const action of ["accept", "dispute"] as const)
    app.post<{ Params: { id: string } }>(
      `/v1/debts/:id/${action}`,
      async (req) => {
        const u = await identity(req.headers.authorization);
        const id = uuidInput.parse(req.params.id);
        const reason =
          action === "dispute"
            ? disputeInput.parse(req.body).reason
            : (z
                .object({})
                .strict()
                .parse(req.body ?? {}),
              undefined);
        return {
          debt: await options.store.respond(
            id,
            u,
            action === "accept" ? "accepted" : "disputed",
            reason,
          ),
        };
      },
    );
  app.get("/v1/balances", async (req) => {
    const u = await identity(req.headers.authorization);
    return { balances: balances(await options.store.listFor(u), u) };
  });
  app.get("/v1/people", async (req) => {
    const user = await identity(req.headers.authorization);
    return { people: await options.store.directory.listPeople(user) };
  });
  app.post("/v1/people", async (req, reply) => {
    const user = await identity(req.headers.authorization);
    return reply.code(201).send({
      person: await options.store.directory.createPerson(
        user,
        personInput.parse(req.body),
      ),
    });
  });
  app.get("/v1/vaults", async (req) => {
    const user = await identity(req.headers.authorization);
    return { vaults: await options.store.directory.listVaults(user) };
  });
  app.post("/v1/vaults", async (req, reply) => {
    const user = await identity(req.headers.authorization);
    return reply
      .code(201)
      .send(
        await options.store.directory.createVault(
          user,
          vaultInput.parse(req.body),
        ),
      );
  });
  app.get<{ Params: { id: string } }>("/v1/vaults/:id", async (req) => {
    const user = await identity(req.headers.authorization);
    return options.store.directory.vault(user, uuidInput.parse(req.params.id));
  });
  for (const add of [true, false])
    app.post<{ Params: { id: string } }>(
      `/v1/vaults/:id/members${add ? "" : "/remove"}`,
      async (req) => {
        const user = await identity(req.headers.authorization);
        return options.store.directory.member(
          user,
          uuidInput.parse(req.params.id),
          memberInput.parse(req.body).personId,
          add,
        );
      },
    );
  return app;
}
