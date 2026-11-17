import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createDebt, type Identity } from "../src/domain.js";
import {
  MemoryStore,
  PostgresStore,
  type SqlClient,
  type SqlPool,
  type Store,
} from "../src/store.js";
const lender = { id: "alex", email: "alex@example.com" };
const borrower = { id: "john", email: "john@example.com" };
const input = {
  borrowerEmail: borrower.email,
  amountMinor: 100,
  currency: "AED" as const,
  description: "Test",
};
async function boundIdentity(store: Store) {
  try {
    const debt = await store.create(createDebt(input, lender));
    assert.equal((await store.listFor(borrower)).length, 1);
    await store.respond(debt.id, borrower, "accepted");
    const renamed = { ...borrower, email: "new@example.com" };
    assert.equal((await store.listFor(renamed)).length, 1);
    await assert.rejects(store.respond(debt.id, renamed, "accepted"), {
      status: 409,
    });
    assert.equal(
      (await store.listFor({ id: "new-owner", email: borrower.email })).length,
      0,
    );
    await assert.rejects(
      store.respond(
        debt.id,
        { id: "new-owner", email: borrower.email },
        "disputed",
        "Wrong",
      ),
      { status: 404 },
    );
    await assert.rejects(store.respond(debt.id, borrower, "accepted"), {
      status: 409,
    });
    const reloaded = (await store.listFor(lender))[0];
    assert.equal(reloaded.status, "accepted");
    assert.equal(reloaded.history.length, 2);
    assert.equal(typeof reloaded.createdAt, "string");
  } finally {
    await store.close();
  }
}
test("memory binds answered debt to stable borrower identity", async () =>
  boundIdentity(new MemoryStore()));
test("embedded PostgreSQL migration and production SQL store work together", async () => {
  const db = new PGlite();
  await db.exec(
    await readFile(
      new URL("../migrations/001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  const query: SqlClient["query"] = async (sql, values) => ({
    rows: (await db.query(sql, values)).rows as never[],
  });
  const adapter: SqlPool = {
    query,
    connect: async () => ({ query, release() {} }),
    end: () => db.close(),
  };
  const store = new PostgresStore(adapter);
  await boundIdentity(store);
});

test(
  "network PostgreSQL row locks serialize competing responses",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const pg = await import("pg");
    const url = process.env.DATABASE_URL!;
    const store = new PostgresStore(url);
    const debt = await store.create(createDebt(input, lender));
    try {
      const results = await Promise.allSettled([
        store.respond(debt.id, borrower, "accepted"),
        store.respond(debt.id, borrower, "disputed", "Incorrect"),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = results.find((r) => r.status === "rejected");
      assert.equal(
        rejected?.status === "rejected" && rejected.reason.status,
        409,
      );
      const reader = new PostgresStore(url);
      try {
        assert.equal(
          (await reader.listFor(lender)).find((d) => d.id === debt.id)?.history
            .length,
          2,
        );
      } finally {
        await reader.close();
      }
    } finally {
      const client = new pg.default.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query("DELETE FROM debts WHERE id=$1", [debt.id]);
      } finally {
        await client.end();
        await store.close();
      }
    }
  },
);
