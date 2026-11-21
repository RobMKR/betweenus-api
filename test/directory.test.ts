import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { demoAuth } from "../src/auth.js";
import { createDebt } from "../src/domain.js";
import {
  MemoryStore,
  PostgresStore,
  type SqlClient,
  type SqlPool,
} from "../src/store.js";
import {
  MemoryDirectory,
  type DirectoryStore,
} from "../src/directory-store.js";
const owner = { id: "demo-alex", email: "alex@example.com" };
const other = { id: "demo-john", email: "john@example.com" };
const person = { name: "Friday friend", source: "custom" as const };
async function appFixture() {
  const app = await buildApp({
    store: new MemoryStore(),
    auth: demoAuth(),
    demo: true,
  });
  const call = (
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
    token = "demo-lender",
  ) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return { app, call };
}
test("saved People are private chosen fields, never verified identity or bulk contacts", async () => {
  const { app, call } = await appFixture();
  try {
    for (const url of ["/v1/people", "/v1/vaults"])
      assert.equal((await app.inject({ method: "GET", url })).statusCode, 401);
    for (const input of [
      { ...person, name: "" },
      { ...person, name: "a".repeat(101) },
      { ...person, source: "verified" },
      { ...person, ownerId: other.id },
      { ...person, phone: "no-number" },
      { ...person, phone: "+" },
      { ...person, phone: "1".repeat(41) },
      { ...person, email: "bad" },
      [person],
      { contacts: [person] },
      { ...person, contactId: "device-42" },
      { ...person, photo: "url" },
      { ...person, verifiedUserId: other.id },
    ])
      assert.equal((await call("POST", "/v1/people", input)).statusCode, 400);
    const first = await call("POST", "/v1/people", {
      name: " John ",
      source: "contact",
      email: " JOHN@example.com ",
      phone: " +971 (50) 123-4567 ",
    });
    assert.equal(first.statusCode, 201);
    const p = first.json().person;
    assert.equal(p.name, "John");
    assert.equal(p.email, "john@example.com");
    assert.equal(p.phone, "+971 (50) 123-4567");
    assert.equal(p.source, "contact");
    assert.equal("ownerId" in p, false);
    assert.equal("userId" in p, false);
    const second = (
      await call("POST", "/v1/people", { name: "John", source: "custom" })
    ).json().person;
    assert.notEqual(p.id, second.id);
    assert.equal(second.email, null);
    assert.equal(second.phone, null);
    assert.equal(
      (await call("GET", "/v1/people", undefined, "demo-borrower")).json()
        .people.length,
      0,
    );
    assert.equal((await call("GET", "/v1/people")).json().people.length, 2);
  } finally {
    await app.close();
  }
});
test("vault routes reject duplicate/foreign selections and authorize each membership mutation", async () => {
  const { app, call } = await appFixture();
  try {
    const p = (await call("POST", "/v1/people", person)).json().person;
    const foreign = (
      await call("POST", "/v1/people", person, "demo-borrower")
    ).json().person;
    for (const patch of [
      { memberIds: [p.id, p.id] },
      { memberIds: ["self"] },
      { memberIds: Array.from({ length: 101 }, () => randomUUID()) },
      { title: "" },
      { kind: "shared" },
      { date: "2026-11-24" },
      { ownerId: other.id },
    ])
      assert.equal(
        (
          await call("POST", "/v1/vaults", {
            title: "Football",
            kind: "permanent",
            memberIds: [],
            ...patch,
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (
        await call("POST", "/v1/vaults", {
          title: "No partial save",
          kind: "temporary",
          memberIds: [p.id, foreign.id],
        })
      ).statusCode,
      404,
    );
    assert.equal((await call("GET", "/v1/vaults")).json().vaults.length, 0);
    const created = await call("POST", "/v1/vaults", {
      title: " Friday Football ",
      kind: "permanent",
      memberIds: [p.id],
    });
    assert.equal(created.statusCode, 201);
    const detail = created.json();
    assert.equal(detail.vault.title, "Friday Football");
    assert.equal(detail.vault.archived, false);
    assert.deepEqual(
      detail.members.map((m: { id: string }) => m.id),
      [p.id],
    );
    const path = `/v1/vaults/${detail.vault.id}`;
    assert.equal(
      (await call("GET", path, undefined, "demo-borrower")).statusCode,
      404,
    );
    assert.equal(
      (await call("GET", "/v1/vaults", undefined, "demo-borrower")).json()
        .vaults.length,
      0,
    );
    for (const suffix of ["/members", "/members/remove"]) {
      assert.equal(
        (await call("POST", path + suffix, { personId: p.id }, "demo-borrower"))
          .statusCode,
        404,
      );
      assert.equal(
        (await call("POST", path + suffix, { personId: foreign.id }))
          .statusCode,
        404,
      );
    }
    const again = (
      await call("POST", path + "/members", { personId: p.id })
    ).json();
    assert.equal(again.history.length, detail.history.length);
    assert.equal(again.vault.updatedAt, detail.vault.updatedAt);
    await call("POST", path + "/members/remove", { personId: p.id });
    const removed = (
      await call("POST", path + "/members/remove", { personId: p.id })
    ).json();
    assert.deepEqual(removed.vault.memberIds, []);
    assert.equal(removed.history.length, detail.history.length + 1);
    assert.equal(removed.history.at(-1).personId, p.id);
    assert.equal((await call("GET", "/v1/people")).json().people.length, 1);
  } finally {
    await app.close();
  }
});
async function lifecycle(directory: DirectoryStore) {
  const a = await directory.createPerson(owner, person),
    b = await directory.createPerson(owner, person),
    foreign = await directory.createPerson(other, person);
  await assert.rejects(
    directory.createVault(owner, {
      title: "Invalid",
      kind: "temporary",
      memberIds: [a.id, foreign.id],
    }),
    { status: 404 },
  );
  assert.equal((await directory.listVaults(owner)).length, 0);
  const original = await directory.createVault(owner, {
    title: "Friday Football",
    kind: "permanent",
    memberIds: [a.id, b.id],
  });
  const id = original.vault.id;
  assert.notEqual(a.id, b.id);
  assert.deepEqual(original.vault.memberIds, [a.id, b.id]);
  assert.deepEqual(
    original.members.map((p) => p.id),
    [a.id, b.id],
  );
  assert.equal((await directory.listPeople(other)).length, 1);
  assert.equal((await directory.listVaults(other)).length, 0);
  await assert.rejects(directory.vault(other, id), { status: 404 });
  for (const add of [true, false])
    await assert.rejects(directory.member(owner, id, foreign.id, add), {
      status: 404,
    });
  const same = await directory.member(owner, id, a.id, true);
  assert.deepEqual(same, original);
  await directory.member(owner, id, a.id, false);
  const once = await directory.vault(owner, id);
  const twice = await directory.member(owner, id, a.id, false);
  assert.deepEqual(twice, once);
  assert.equal(twice.history.length, original.history.length + 1);
  const restored = await directory.member(owner, id, a.id, true);
  assert.deepEqual(restored.vault.memberIds, [b.id, a.id]);
  assert.equal(restored.history.length, original.history.length + 2);
  assert.deepEqual(
    restored.history.slice(0, original.history.length),
    original.history,
  );
  restored.vault.memberIds.length = 0;
  assert.equal((await directory.vault(owner, id)).vault.memberIds.length, 2);
  return id;
}
test("memory directory preserves roster order and immutable prior history across retries", async () =>
  lifecycle(new MemoryDirectory()));
test("member cap preserves existing idempotent operations at the limit", async () => {
  const directory = new MemoryDirectory();
  const people = [];
  for (let i = 0; i < 101; i++)
    people.push(
      await directory.createPerson(owner, { ...person, name: `Person ${i}` }),
    );
  const initial = await directory.createVault(owner, {
    title: "Team",
    kind: "temporary",
    memberIds: people.slice(0, 100).map((p) => p.id),
  });
  await directory.member(owner, initial.vault.id, people[0].id, true);
  await assert.rejects(
    directory.member(owner, initial.vault.id, people[100].id, true),
    { status: 400 },
  );
  assert.deepEqual(await directory.vault(owner, initial.vault.id), initial);
});
test("SQL migration preserves old debt data, enforces owner FKs/RLS and rolls back partial mutations", async () => {
  const db = new PGlite();
  const query: SqlClient["query"] = async (sql, values) => ({
    rows: (await db.query(sql, values)).rows as never[],
  });
  const adapter: SqlPool = {
    query,
    connect: async () => ({ query, release() {} }),
    end: () => db.close(),
  };
  const store = new PostgresStore(adapter);
  try {
    await db.exec(
      await readFile(
        new URL("../migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    const debt = await store.create(
      createDebt(
        {
          borrowerEmail: other.email,
          amountMinor: 63000,
          currency: "AED",
          description: "Existing debt",
        },
        owner,
      ),
    );
    await store.respond(debt.id, other, "accepted");
    const before = await store.listFor(owner);
    await db.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT USAGE,SELECT ON SEQUENCES TO anon,authenticated;",
    );
    await db.exec(
      await readFile(
        new URL("../migrations/002_people_vaults.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(await store.listFor(owner), before);
    const id = await lifecycle(store.directory);
    const reader = new PostgresStore(adapter);
    assert.equal((await reader.directory.vault(owner, id)).members.length, 2);
    const p = (await store.directory.listPeople(other))[0];
    await assert.rejects(
      db.query(
        "INSERT INTO vault_members(vault_id,owner_id,person_id) VALUES($1,$2,$3)",
        [id, owner.id, p.id],
      ),
    );
    for (const table of [
      "saved_people",
      "vaults",
      "vault_members",
      "vault_history",
    ]) {
      const protection = await db.query<{
        relrowsecurity: boolean;
        allowed: boolean;
      }>(
        "SELECT relrowsecurity,has_table_privilege('anon',$1,'SELECT') AS allowed FROM pg_class WHERE relname=$1",
        [table],
      );
      assert.equal(protection.rows[0].relrowsecurity, true);
      assert.equal(protection.rows[0].allowed, false);
    }
    for (const role of ["anon", "authenticated"]) {
      for (const sequence of [
        "vault_members_position_seq",
        "vault_history_position_seq",
      ]) {
        const result = await db.query<{ allowed: boolean }>(
          "SELECT has_sequence_privilege($1,$2,'USAGE') AS allowed",
          [role, sequence],
        );
        assert.equal(result.rows[0].allowed, false);
      }
    }
    const beforeVaults = await store.directory.listVaults(owner);
    const selected = (await store.directory.listPeople(owner))[0];
    const broken: SqlPool = {
      ...adapter,
      connect: async () => ({
        release() {},
        query: async (sql, values) => {
          if (
            sql.startsWith("INSERT INTO vault_history") &&
            String(values?.[3]).startsWith("member_")
          )
            throw Error("Simulated history write failure");
          return query(sql, values);
        },
      }),
    };
    const failing = new PostgresStore(broken);
    await assert.rejects(
      failing.directory.createVault(owner, {
        title: "Must roll back",
        kind: "temporary",
        memberIds: [selected.id],
      }),
      /Simulated/,
    );
    assert.deepEqual(await store.directory.listVaults(owner), beforeVaults);
    const old = await store.directory.vault(owner, id);
    await assert.rejects(
      failing.directory.member(owner, id, old.vault.memberIds[0], false),
      /Simulated/,
    );
    assert.deepEqual(await store.directory.vault(owner, id), old);
    assert.deepEqual(await store.listFor(owner), before);
  } finally {
    await store.close();
  }
});

test(
  "network PostgreSQL serializes simultaneous duplicate membership additions",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const pg = await import("pg");
    const url = process.env.DATABASE_URL!;
    const store = new PostgresStore(url);
    const user = {
      id: `directory-test-${randomUUID()}`,
      email: "directory-test@example.com",
    };
    try {
      const p = await store.directory.createPerson(user, person);
      const v = await store.directory.createVault(user, {
        title: "Concurrency test",
        kind: "temporary",
        memberIds: [],
      });
      const results = await Promise.all([
        store.directory.member(user, v.vault.id, p.id, true),
        store.directory.member(user, v.vault.id, p.id, true),
      ]);
      assert.equal(results.length, 2);
      const detail = await store.directory.vault(user, v.vault.id);
      assert.deepEqual(detail.vault.memberIds, [p.id]);
      assert.deepEqual(
        detail.history.map((e) => e.action),
        ["created", "member_added"],
      );
    } finally {
      const client = new pg.default.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query("BEGIN");
        for (const table of [
          "vault_history",
          "vault_members",
          "vaults",
          "saved_people",
        ])
          await client.query(`DELETE FROM ${table} WHERE owner_id=$1`, [
            user.id,
          ]);
        await client.query("COMMIT");
      } finally {
        await client.end();
        await store.close();
      }
    }
  },
);
