import { buildApp } from "./app.js";
import { demoAuth, supabaseAuth } from "./auth.js";
import { MemoryStore, PostgresStore } from "./store.js";
const demo = process.env.DEMO_MODE === "true";
const host = process.env.HOST ?? "127.0.0.1";
if (
  demo &&
  (process.env.NODE_ENV === "production" ||
    !["127.0.0.1", "localhost", "::1"].includes(host))
)
  throw new Error("Demo mode is local only and forbidden in production.");
if (
  !demo &&
  (!process.env.DATABASE_URL ||
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_ANON_KEY)
)
  throw new Error(
    "Set DATABASE_URL, SUPABASE_URL and SUPABASE_ANON_KEY, or explicitly enable local DEMO_MODE=true.",
  );
if (!demo && !process.env.SUPABASE_URL?.startsWith("https://"))
  throw new Error("SUPABASE_URL must use HTTPS.");
const app = await buildApp({
  store: demo
    ? new MemoryStore()
    : new PostgresStore(process.env.DATABASE_URL!),
  auth: demo
    ? demoAuth()
    : supabaseAuth(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!),
  demo,
  logger: true,
  origins: (
    process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:8081"
  ).split(","),
});
if (demo)
  app.log.warn(
    "LOCAL DEMO: public fake identities; in-memory data is lost on restart.",
  );
await app.listen({ port: Number(process.env.PORT ?? 3001), host });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
