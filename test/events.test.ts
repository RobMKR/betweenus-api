import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { ZodError } from "zod";
import { buildApp } from "../src/app.js";
import { demoAuth } from "../src/auth.js";
import { createDebt } from "../src/domain.js";
import {
  eventInput,
  makeEvent,
  viewEvent,
  type EventInput,
} from "../src/events.js";
import {
  MemoryStore,
  PostgresStore,
  type Store,
  type SqlClient,
  type SqlPool,
} from "../src/store.js";
const owner = { id: "demo-alex", email: "alex@example.com" },
  other = { id: "demo-john", email: "john@example.com" };
const base = (
  participantIds: string[],
  changes: Partial<EventInput> = {},
): EventInput => ({
  clientRequestId: randomUUID(),
  title: "Friday Football",
  date: "2026-11-21",
  currency: "AED",
  totalMinor: 63000,
  participantIds,
  payerId: "self",
  splitMode: "equal",
  ...changes,
});
const people = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    name: `Friend ${index}`,
  }));
test("equal allocation preserves 630/14, small remainders, and payer/self variants", () => {
  const saved = people(13);
  const input = eventInput.parse(base(["self", ...saved.map((p) => p.id)]));
  const event = viewEvent(makeEvent(randomUUID(), input, saved));
  assert.ok(event.participants.every((p) => p.shareMinor === 4500));
  assert.equal(event.balance.receivableMinor, 58500);
  assert.equal(event.participants[0].remainingMinor, 0);
  const tiny = viewEvent(
    makeEvent(
      randomUUID(),
      eventInput.parse(
        base(["self", ...saved.map((p) => p.id)], { totalMinor: 2 }),
      ),
      saved,
    ),
  );
  assert.deepEqual(
    tiny.participants.map((p) => p.shareMinor),
    [1, 1, ...Array(12).fill(0)],
  );
  assert.equal(tiny.balance.receivableMinor, 1);
  const externalSelf = viewEvent(
    makeEvent(
      randomUUID(),
      eventInput.parse(base([saved[0].id], { totalMinor: 101 })),
      saved,
    ),
  );
  assert.equal(externalSelf.balance.receivableMinor, 101);
  const otherPayer = viewEvent(
    makeEvent(
      randomUUID(),
      eventInput.parse(
        base(["self", saved[0].id], { totalMinor: 101, payerId: saved[0].id }),
      ),
      saved,
    ),
  );
  assert.equal(otherPayer.balance.payableMinor, 51);
  assert.equal(otherPayer.participants[1].remainingMinor, 0);
  const neither = viewEvent(
    makeEvent(
      randomUUID(),
      eventInput.parse(
        base([saved[0].id, saved[1].id], { payerId: saved[1].id }),
      ),
      saved,
    ),
  );
  assert.equal(neither.balance.netMinor, 0);
});
test("strict manual allocations preserve explicit integer shares and reject malformed dates/identities/data", () => {
  const saved = people(2);
  const input = base(["self", saved[0].id], {
    totalMinor: 101,
    splitMode: "manual",
    allocations: [
      { participantId: saved[0].id, shareMinor: 81 },
      { participantId: "self", shareMinor: 20 },
    ],
  });
  const event = viewEvent(
    makeEvent(randomUUID(), eventInput.parse(input), saved),
  );
  assert.deepEqual(
    event.participants.map((p) => p.shareMinor),
    [20, 81],
  );
  assert.equal(event.balance.receivableMinor, 81);
  const invalid = [
    { totalMinor: 0 },
    { totalMinor: 1.5 },
    { totalMinor: 1_000_000_001 },
    { currency: "USD" },
    { date: "2026-02-30" },
    { date: "0000-01-01" },
    { date: "2026-11-21T00:00:00Z" },
    { participantIds: [] },
    { participantIds: ["self", "self"] },
    { payerId: saved[1].id },
    { allocations: [{ participantId: "self", shareMinor: 100 }] },
    {
      allocations: [
        { participantId: "self", shareMinor: 100 },
        { participantId: "self", shareMinor: 1 },
      ],
    },
    {
      allocations: [
        { participantId: "self", shareMinor: 20 },
        { participantId: saved[0].id, shareMinor: 82 },
      ],
    },
    {
      allocations: [
        { participantId: "self", shareMinor: -1 },
        { participantId: saved[0].id, shareMinor: 102 },
      ],
    },
    { ownerId: owner.id },
    { participants: [{ name: "Injected owner" }] },
  ];
  for (const patch of invalid)
    assert.throws(() => eventInput.parse({ ...input, ...patch }));
  assert.throws(() => eventInput.parse({ ...input, splitMode: "equal" }));
  assert.equal(
    eventInput.parse({ ...input, date: "2000-02-29" }).date,
    "2000-02-29",
  );
});
async function lifecycle(store: Store) {
  const a = await store.directory.createPerson(owner, {
      name: "Same name",
      source: "custom",
    }),
    b = await store.directory.createPerson(owner, {
      name: "Same name",
      source: "contact",
      phone: "+971 50 1234",
    }),
    foreign = await store.directory.createPerson(other, {
      name: "Other owner",
      source: "custom",
    });
  const vault = await store.directory.createVault(owner, {
    title: "Team",
    kind: "permanent",
    memberIds: [a.id, b.id],
  });
  const id = vault.vault.id;
  const intent = base(["self", a.id, b.id], { totalMinor: 100 });
  const created = await store.events.create(owner, id, intent);
  assert.equal(created.partialPayments, true);
  assert.equal(created.balance.receivableMinor, 66);
  assert.notEqual(
    created.participants[1].participantId,
    created.participants[2].participantId,
  );
  assert.equal(created.participants[1].name, created.participants[2].name);
  const same = await store.events.create(owner, id, intent);
  assert.equal(same.id, created.id);
  assert.equal((await store.events.list(owner, id)).length, 1);
  const payment = {
    clientRequestId: randomUUID(),
    participantId: a.id,
    amountMinor: 10,
  };
  const paid = await store.events.pay(owner, created.id, payment);
  assert.equal(paid.participants[1].remainingMinor, 23);
  assert.equal(
    (await store.events.pay(owner, created.id, payment)).payments.length,
    1,
  );
  const retriedCreate = await store.events.create(owner, id, intent);
  assert.equal(retriedCreate.payments.length, 1);
  assert.equal(retriedCreate.participants[1].remainingMinor, 23);
  await assert.rejects(
    store.events.pay(owner, created.id, { ...payment, amountMinor: 11 }),
    { status: 409 },
  );
  await assert.rejects(store.events.get(other, created.id), { status: 404 });
  await assert.rejects(store.events.list(other, id), { status: 404 });
  await assert.rejects(
    store.events.pay(other, created.id, {
      ...payment,
      clientRequestId: randomUUID(),
    }),
    { status: 404 },
  );
  await assert.rejects(
    store.events.pay(owner, created.id, {
      ...payment,
      participantId: "self",
      clientRequestId: randomUUID(),
    }),
    { status: 409 },
  );
  await assert.rejects(
    store.events.pay(owner, created.id, {
      ...payment,
      amountMinor: 24,
      clientRequestId: randomUUID(),
    }),
    { status: 409 },
  );
  await store.events.pay(owner, created.id, {
    ...payment,
    amountMinor: 23,
    clientRequestId: randomUUID(),
  });
  const undo = { clientRequestId: randomUUID() };
  const restored = await store.events.undo(
    owner,
    created.id,
    paid.payments[0].id,
    undo,
  );
  assert.equal(restored.participants[1].remainingMinor, 10);
  assert.equal(restored.payments[2].amountMinor, -10);
  assert.equal(restored.payments[2].reversesId, paid.payments[0].id);
  assert.equal(
    (await store.events.undo(owner, created.id, paid.payments[0].id, undo))
      .payments.length,
    3,
  );
  await assert.rejects(
    store.events.undo(owner, created.id, paid.payments[0].id, {
      clientRequestId: randomUUID(),
    }),
    { status: 409 },
  );
  await assert.rejects(
    store.events.undo(owner, created.id, restored.payments[2].id, {
      clientRequestId: randomUUID(),
    }),
    { status: 409 },
  );
  await assert.rejects(
    store.events.undo(owner, created.id, paid.payments[0].id, {
      clientRequestId: intent.clientRequestId,
    }),
    { status: 409 },
  );
  await store.directory.member(owner, id, a.id, false);
  assert.deepEqual(
    (await store.events.get(owner, created.id)).participants,
    restored.participants,
  );
  const archived = await store.events.archive(owner, id, true);
  assert.equal(archived.vault.archived, true);
  assert.equal(archived.vault.eventCount, 1);
  assert.equal(archived.vault.balances[0].netMinor, 43);
  assert.equal((await store.events.balances(owner))[0].netMinor, 43);
  assert.deepEqual(await store.events.archive(owner, id, true), archived);
  const blocked = {
    clientRequestId: randomUUID(),
    participantId: b.id,
    amountMinor: 1,
  };
  await assert.rejects(store.events.create(owner, id, base([b.id])), {
    status: 409,
  });
  await assert.rejects(store.events.pay(owner, created.id, blocked), {
    status: 409,
  });
  await assert.rejects(
    store.events.undo(owner, created.id, restored.payments[1].id, {
      clientRequestId: randomUUID(),
    }),
    { status: 409 },
  );
  assert.equal(
    (await store.events.create(owner, id, intent)).payments.length,
    3,
  ); // successful old intent is a read, not a new archived write
  await store.events.archive(owner, id, false);
  const resumed = await store.events.pay(owner, created.id, blocked);
  assert.equal(resumed.balance.netMinor, 42);
  const manual = await store.events.create(
    owner,
    id,
    base(["self", a.id], {
      totalMinor: 100,
      payerId: a.id,
      splitMode: "manual",
      allocations: [
        { participantId: "self", shareMinor: 40 },
        { participantId: a.id, shareMinor: 60 },
      ],
    }),
  );
  assert.equal(manual.balance.payableMinor, 40);
  const summary = (await store.events.vaults(owner, [archived.vault]))[0];
  assert.equal(summary.eventCount, 2);
  assert.equal(summary.balances[0].receivableMinor, 42);
  assert.equal(summary.balances[0].payableMinor, 40);
  assert.equal(summary.balances[0].netMinor, 2);
  const bad = base([foreign.id]);
  await assert.rejects(store.events.create(owner, id, bad), { status: 404 });
  assert.equal((await store.events.list(owner, id)).length, 2);
  await store.events.create(owner, id, { ...bad, participantIds: [a.id] }); // failed transaction must not reserve the request ID
  assert.equal((await store.events.balances(other))[0].netMinor, 0);
  return { id, eventId: created.id, a, b };
}
test("memory event lifecycle preserves snapshots, retries, partial/full repayment, undo and archived totals", async () => {
  const store = new MemoryStore();
  await lifecycle(store);
});
async function paymentPolicy(store: Store, user = owner) {
  const person = await store.directory.createPerson(user, {
    name: "Friend",
    source: "custom",
  });
  const { vault } = await store.directory.createVault(user, {
    title: "Partial payment policy",
    kind: "temporary",
    memberIds: [],
  });
  const explicit = await store.events.create(
    user,
    vault.id,
    base([person.id], { totalMinor: 100, partialPayments: true }),
  );
  const partial = {
    clientRequestId: randomUUID(),
    participantId: person.id,
    amountMinor: 40,
  };
  const partPaid = await store.events.pay(user, explicit.id, partial);
  assert.equal(partPaid.partialPayments, true);
  assert.equal(partPaid.participants[0].remainingMinor, 60);

  const intent = base(["self", person.id], {
    totalMinor: 100,
    splitMode: "manual",
    allocations: [
      { participantId: person.id, shareMinor: 60 },
      { participantId: "self", shareMinor: 40 },
    ],
    partialPayments: false,
  });
  const event = await store.events.create(user, vault.id, intent);
  assert.equal(event.partialPayments, false);
  assert.equal((await store.events.get(user, event.id)).partialPayments, false);
  assert.equal(
    (await store.events.list(user, vault.id)).find(({ id }) => id === event.id)
      ?.partialPayments,
    false,
  );
  await assert.rejects(
    store.events.create(user, vault.id, { ...intent, partialPayments: true }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const payment = { ...partial, clientRequestId: randomUUID() };
  await assert.rejects(store.events.pay(user, event.id, payment), {
    status: 409,
    code: "FULL_PAYMENT_REQUIRED",
  });
  await assert.rejects(
    store.events.pay(user, event.id, { ...payment, amountMinor: 61 }),
    { status: 409, code: "OVERPAYMENT" },
  );
  await assert.rejects(
    store.events.pay(user, event.id, { ...payment, participantId: "self" }),
    { status: 409, code: "PAYER_PAYMENT" },
  );
  assert.deepEqual(await store.events.get(user, event.id), event);
  const full = { ...payment, amountMinor: 60 };
  const paid = await store.events.pay(user, event.id, full);
  assert.equal(paid.participants[1].remainingMinor, 0);
  assert.deepEqual(await store.events.pay(user, event.id, full), paid);
  const restored = await store.events.undo(
    user,
    event.id,
    paid.payments[0].id,
    {
      clientRequestId: randomUUID(),
    },
  );
  assert.equal(restored.participants[1].remainingMinor, 60);
  assert.equal(restored.payments[1].reversesId, paid.payments[0].id);
  assert.deepEqual(await store.events.pay(user, event.id, full), restored);
  assert.deepEqual(await store.events.create(user, vault.id, intent), restored);
  return { event, full, restored };
}
async function concurrentFullPayments(store: Store, user = owner) {
  const { event, full } = await paymentPolicy(store, user);
  const a = { ...full, clientRequestId: randomUUID() };
  const b = { ...full, clientRequestId: randomUUID() };
  const results = await Promise.allSettled([
    store.events.pay(user, event.id, a),
    store.events.pay(user, event.id, a),
    store.events.pay(user, event.id, b),
    store.events.pay(user, event.id, b),
  ]);
  const current = await store.events.get(user, event.id);
  assert.equal(current.payments.length, 3);
  assert.equal(current.participants[1].remainingMinor, 0);
  const successes = results.filter((result) => result.status === "fulfilled");
  assert.deepEqual(
    successes.map((result) => result.value),
    [current, current],
  );
  const failures = results.filter((result) => result.status === "rejected");
  assert.deepEqual(
    failures.map((result) => result.reason.code),
    ["OVERPAYMENT", "OVERPAYMENT"],
  );
}
test("memory full-share policy validates remaining amounts and serializes concurrent payments", async () => {
  await concurrentFullPayments(new MemoryStore());
});
test("simultaneous memory retries serialize and overpayment does not reserve a failed intent", async () => {
  const store = new MemoryStore();
  const a = await store.directory.createPerson(owner, {
    name: "Friend",
    source: "custom",
  });
  const v = await store.directory.createVault(owner, {
    title: "Retry",
    kind: "temporary",
    memberIds: [],
  });
  const input = base([a.id], { totalMinor: 100 });
  const created = await Promise.all([
    store.events.create(owner, v.vault.id, input),
    store.events.create(owner, v.vault.id, input),
  ]);
  assert.equal(created[0].id, created[1].id);
  const results = await Promise.allSettled([
    store.events.pay(owner, created[0].id, {
      clientRequestId: randomUUID(),
      participantId: a.id,
      amountMinor: 70,
    }),
    store.events.pay(owner, created[0].id, {
      clientRequestId: randomUUID(),
      participantId: a.id,
      amountMinor: 70,
    }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    (await store.events.get(owner, created[0].id)).payments.length,
    1,
  );
});
test("event routes enforce auth/validation, maximum manual payload, extended vault DTO and separate balances", async () => {
  const store = new MemoryStore();
  const app = await buildApp({ store, auth: demoAuth(), demo: true });
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
  try {
    assert.equal(
      (await app.inject({ method: "GET", url: "/v1/vault-balances" }))
        .statusCode,
      401,
    );
    const persons = [];
    for (let index = 0; index < 100; index++)
      persons.push(
        await store.directory.createPerson(owner, {
          name: `Member ${index}`,
          source: "custom",
        }),
      );
    const response = await call("POST", "/v1/vaults", {
      title: "All members",
      kind: "permanent",
      memberIds: [],
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().vault.eventCount, 0);
    assert.equal(response.json().vault.balances[0].netMinor, 0);
    const id = response.json().vault.id;
    const manual = base(
      persons.map((p) => p.id),
      {
        totalMinor: 101,
        splitMode: "manual",
        partialPayments: false,
        allocations: persons.map((p, index) => ({
          participantId: p.id,
          shareMinor: index === 0 ? 2 : 1,
        })),
      },
    );
    assert.ok(JSON.stringify(manual).length > 8192);
    for (const partialPayments of ["false", 0, null]) {
      const invalid = await call("POST", `/v1/vaults/${id}/events`, {
        ...manual,
        partialPayments,
      });
      assert.equal(invalid.statusCode, 400);
    }
    const saved = await call("POST", `/v1/vaults/${id}/events`, manual);
    assert.equal(saved.statusCode, 201);
    const event = saved.json().event;
    assert.equal(event.partialPayments, false);
    assert.equal(event.participants.length, 100);
    assert.equal(event.balance.netMinor, 101);
    assert.equal(
      (await call("GET", `/v1/events/${event.id}`, undefined, "demo-borrower"))
        .statusCode,
      404,
    );
    assert.equal(
      (await call("GET", "/v1/vault-balances")).json().balances[0].netMinor,
      101,
    );
    assert.equal(
      (await call("GET", "/v1/balances")).json().balances[0].netMinor,
      0,
    );
    for (const patch of [
      { amountMinor: -1 },
      { amountMinor: 0 },
      { amountMinor: 1.5 },
      { participantId: "bad" },
      { ownerId: owner.id },
      { clientRequestId: "missing" },
    ])
      assert.equal(
        (
          await call("POST", `/v1/events/${event.id}/payments`, {
            clientRequestId: randomUUID(),
            participantId: persons[0].id,
            amountMinor: 1,
            ...patch,
          })
        ).statusCode,
        400,
      );
    const payment = {
      clientRequestId: randomUUID(),
      participantId: persons[0].id,
      amountMinor: 1,
    };
    const paymentRoute = `/v1/events/${event.id}/payments`;
    const rejected = await call("POST", paymentRoute, payment);
    assert.equal(rejected.statusCode, 409);
    assert.equal(rejected.json().error.code, "FULL_PAYMENT_REQUIRED");
    const paid = await call("POST", paymentRoute, {
      ...payment,
      amountMinor: 2,
    });
    assert.equal(paid.statusCode, 200);
    assert.equal(paid.json().event.partialPayments, false);
    assert.equal(paid.json().event.balance.netMinor, 99);
    const undone = await call(
      "POST",
      `/v1/events/${event.id}/payments/${paid.json().event.payments[0].id}/undo`,
      { clientRequestId: randomUUID() },
    );
    assert.equal(undone.statusCode, 200);
    assert.equal(undone.json().event.partialPayments, false);
    assert.equal(undone.json().event.balance.netMinor, 101);
    const archived = await call("POST", `/v1/vaults/${id}/archive`, {
      archived: true,
    });
    assert.equal(archived.json().vault.eventCount, 1);
    assert.equal(archived.json().vault.balances[0].netMinor, 101);
    assert.equal(
      (await call("GET", `/v1/vaults/${id}`)).json().vault.eventCount,
      1,
    );
    assert.equal(
      (await call("GET", "/v1/vaults")).json().vaults[0].eventCount,
      1,
    );
    assert.equal(
      (await call("GET", `/v1/vaults/${id}/events`)).json().events.length,
      1,
    );
  } finally {
    await app.close();
  }
});
async function sqlFixture() {
  const db = new PGlite();
  const query: SqlClient["query"] = async (sql, values) => ({
    rows: (await db.query(sql, values)).rows as never[],
  });
  const adapter: SqlPool = {
    query,
    connect: async () => ({ query, release() {} }),
    end: () => db.close(),
  };
  return { db, adapter, store: new PostgresStore(adapter) };
}
test("SQL events preserve base data, owner isolation, idempotent history, RLS and transactional rollback", async () => {
  const { db, adapter, store } = await sqlFixture();
  try {
    for (const file of ["001_initial.sql", "002_people_vaults.sql"])
      await db.exec(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const legacy = await store.create(
      createDebt(
        {
          borrowerEmail: other.email,
          amountMinor: 12345,
          currency: "AED",
          description: "Existing acknowledged debt",
        },
        owner,
      ),
    );
    await store.respond(legacy.id, other, "accepted");
    const debtBefore = await store.listFor(owner);
    const legacyOwner = {
      id: "legacy-owner",
      email: "legacy-owner@example.com",
    };
    const priorVault = await store.directory.createVault(legacyOwner, {
      title: "Existing vault",
      kind: "permanent",
      memberIds: [],
    });
    const before = await store.directory.vault(
      legacyOwner,
      priorVault.vault.id,
    );
    await db.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT USAGE,SELECT ON SEQUENCES TO anon,authenticated;",
    );
    await db.exec(
      await readFile(
        new URL("../migrations/003_account_events.sql", import.meta.url),
        "utf8",
      ),
    );
    const person = await store.directory.createPerson(legacyOwner, {
      name: "Existing participant",
      source: "custom",
    });
    const legacyEvent = {
      clientRequestId: randomUUID(),
      title: "Existing event",
      date: "2026-11-21",
      currency: "AED" as const,
      totalMinor: 100,
      participantIds: ["self", person.id],
      payerId: "self",
      splitMode: "manual" as const,
      allocations: [
        { participantId: "self", shareMinor: 40 },
        { participantId: person.id, shareMinor: 60 },
      ],
    };
    const legacyPay = {
      clientRequestId: randomUUID(),
      participantId: person.id,
      amountMinor: 10,
    };
    const legacyEventId = randomUUID();
    const legacyPaymentId = randomUUID();
    const timestamp = "2026-11-21T12:00:00.000Z";
    await db.query(
      "INSERT INTO vault_events(id,owner_id,vault_id,title,event_date,currency,total_minor,payer_id,split_mode,participants,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)",
      [
        legacyEventId,
        legacyOwner.id,
        priorVault.vault.id,
        legacyEvent.title,
        legacyEvent.date,
        legacyEvent.currency,
        legacyEvent.totalMinor,
        legacyEvent.payerId,
        legacyEvent.splitMode,
        JSON.stringify([
          { participantId: "self", name: "Me", isSelf: true, shareMinor: 40 },
          {
            participantId: person.id,
            name: person.name,
            isSelf: false,
            shareMinor: 60,
          },
        ]),
        timestamp,
      ],
    );
    await db.query(
      "INSERT INTO event_payments(id,owner_id,event_id,participant_id,amount_minor,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        legacyPaymentId,
        legacyOwner.id,
        legacyEventId,
        person.id,
        legacyPay.amountMinor,
        timestamp,
      ],
    );
    // These objects use the serialized field order and normalized allocations of migration 003-era code.
    for (const { action, resource, input } of [
      { action: "create", resource: priorVault.vault.id, input: legacyEvent },
      { action: "pay", resource: legacyEventId, input: legacyPay },
    ]) {
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ action, resource, input }))
        .digest("hex");
      await db.query(
        "INSERT INTO event_requests(owner_id,request_id,fingerprint,action,resource,event_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          legacyOwner.id,
          input.clientRequestId,
          fingerprint,
          action,
          resource,
          legacyEventId,
        ],
      );
    }
    await db.exec(
      await readFile(
        new URL(
          "../migrations/004_event_partial_payments.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const migratedEvent = await store.events.create(
      legacyOwner,
      priorVault.vault.id,
      {
        ...legacyEvent,
        allocations: [...legacyEvent.allocations].reverse(),
      },
    );
    assert.equal(migratedEvent.id, legacyEventId);
    assert.equal(migratedEvent.partialPayments, true);
    assert.equal(migratedEvent.balance.receivableMinor, 50);
    assert.deepEqual(migratedEvent.payments, [
      {
        id: legacyPaymentId,
        participantId: person.id,
        amountMinor: 10,
        createdAt: timestamp,
      },
    ]);
    assert.deepEqual(
      await store.events.pay(legacyOwner, legacyEventId, legacyPay),
      migratedEvent,
    );
    await assert.rejects(
      store.events.create(legacyOwner, priorVault.vault.id, {
        ...legacyEvent,
        partialPayments: true,
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    assert.deepEqual(
      await store.directory.vault(legacyOwner, priorVault.vault.id),
      before,
    );
    const result = await lifecycle(store);
    await paymentPolicy(store);
    assert.deepEqual(await store.listFor(owner), debtBefore);
    for (const role of ["anon", "authenticated"])
      for (const table of [
        "vault_events",
        "event_payments",
        "event_requests",
      ]) {
        const row = (
          await db.query<{ allowed: boolean; relrowsecurity: boolean }>(
            "SELECT relrowsecurity,has_table_privilege($1,$2,'SELECT') AS allowed FROM pg_class WHERE relname=$2",
            [role, table],
          )
        ).rows[0];
        assert.equal(row.allowed, false);
        assert.equal(row.relrowsecurity, true);
      }
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "SELECT has_sequence_privilege('anon','event_payments_position_seq','USAGE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    const broken: SqlPool = {
      ...adapter,
      connect: async () => ({
        release() {},
        query: async (sql, values) => {
          if (sql.startsWith("UPDATE event_requests SET event_id"))
            throw Error("Simulated commit-stage write failure");
          return adapter.query(sql, values);
        },
      }),
    };
    const failing = new PostgresStore(broken);
    const input = base([result.a.id], { totalMinor: 99 });
    const count = (await store.events.list(owner)).length;
    await assert.rejects(
      failing.events.create(owner, result.id, input),
      /Simulated/,
    );
    assert.equal((await store.events.list(owner)).length, count);
    const created = await store.events.create(owner, result.id, input);
    const pay = {
      clientRequestId: randomUUID(),
      participantId: result.a.id,
      amountMinor: 10,
    };
    await assert.rejects(
      failing.events.pay(owner, created.id, pay),
      /Simulated/,
    );
    assert.equal(
      (await store.events.get(owner, created.id)).payments.length,
      0,
    );
    const paid = await store.events.pay(owner, created.id, pay);
    assert.equal(paid.payments.length, 1);
    const undo = { clientRequestId: randomUUID() };
    await assert.rejects(
      failing.events.undo(owner, created.id, paid.payments[0].id, undo),
      /Simulated/,
    );
    assert.equal(
      (await store.events.get(owner, created.id)).payments.length,
      1,
    );
    await store.events.undo(owner, created.id, paid.payments[0].id, undo);
    assert.equal(
      (await store.events.get(owner, created.id)).payments.length,
      2,
    );
    await assert.rejects(
      db.query(
        "INSERT INTO vault_events(id,owner_id,vault_id,title,event_date,currency,total_minor,payer_id,split_mode,participants,created_at,updated_at) VALUES($1,$2,$3,'Bad owner','2026-11-21','AED',1,'self','equal','[{}]',now(),now())",
        [randomUUID(), other.id, result.id],
      ),
    );
  } finally {
    await store.close();
  }
});
test(
  "network PostgreSQL serializes duplicate creates/payments/undo and rejects concurrent overpayment",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const pg = await import("pg");
    const url = process.env.DATABASE_URL!;
    const store = new PostgresStore(url);
    const user = {
      id: `event-test-${randomUUID()}`,
      email: "event-test@example.com",
    };
    try {
      const person = await store.directory.createPerson(user, {
        name: "Test",
        source: "custom",
      });
      const vault = await store.directory.createVault(user, {
        title: "Concurrency",
        kind: "temporary",
        memberIds: [],
      });
      const input = base([person.id], { totalMinor: 100 });
      const created = await Promise.all([
        store.events.create(user, vault.vault.id, input),
        store.events.create(user, vault.vault.id, input),
      ]);
      assert.equal(created[0].id, created[1].id);
      const payment = {
        clientRequestId: randomUUID(),
        participantId: person.id,
        amountMinor: 70,
      };
      await Promise.all([
        store.events.pay(user, created[0].id, payment),
        store.events.pay(user, created[0].id, payment),
      ]);
      const event = await store.events.get(user, created[0].id);
      assert.equal(event.payments.length, 1);
      const undo = { clientRequestId: randomUUID() };
      await Promise.all([
        store.events.undo(user, event.id, event.payments[0].id, undo),
        store.events.undo(user, event.id, event.payments[0].id, undo),
      ]);
      assert.equal((await store.events.get(user, event.id)).payments.length, 2);
      const overpay = await Promise.allSettled([
        store.events.pay(user, event.id, {
          ...payment,
          clientRequestId: randomUUID(),
        }),
        store.events.pay(user, event.id, {
          ...payment,
          clientRequestId: randomUUID(),
        }),
      ]);
      assert.equal(
        overpay.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        overpay.filter((result) => result.status === "rejected").length,
        1,
      );
      await concurrentFullPayments(store, user);
    } finally {
      const client = new pg.default.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query("BEGIN");
        for (const table of [
          "event_requests",
          "event_payments",
          "vault_events",
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

async function reviewInvariantCases(
  store: Store,
  app: Awaited<ReturnType<typeof buildApp>>,
) {
  const person = await store.directory.createPerson(owner, {
    name: "Case person",
    source: "custom",
  });
  const vault = await store.directory.createVault(owner, {
    title: "Review regressions",
    kind: "temporary",
    memberIds: [],
  });
  const nonce = randomUUID();
  const input = base(["self", person.id.toUpperCase()], {
    clientRequestId: nonce.toUpperCase(),
    totalMinor: 100,
    splitMode: "manual",
    allocations: [
      { participantId: person.id.toUpperCase(), shareMinor: 60 },
      { participantId: "self", shareMinor: 40 },
    ],
  });
  const event = await store.events.create(
    owner,
    vault.vault.id.toUpperCase(),
    input,
  );
  assert.equal(event.vaultId, vault.vault.id);
  assert.deepEqual(
    event.participants.map((p) => p.participantId),
    ["self", person.id],
  );
  assert.deepEqual(
    event.participants.map((p) => p.shareMinor),
    [40, 60],
  );
  const equivalent = {
    ...input,
    clientRequestId: nonce,
    participantIds: ["self", person.id],
    allocations: [
      { participantId: "self", shareMinor: 40 },
      { participantId: person.id, shareMinor: 60 },
    ],
  };
  const again = await store.events.create(owner, vault.vault.id, equivalent);
  assert.equal(again.id, event.id);
  assert.equal(
    (await store.events.list(owner, vault.vault.id.toUpperCase())).length,
    1,
  );
  const payNonce = randomUUID();
  const payment = {
    clientRequestId: payNonce.toUpperCase(),
    participantId: person.id.toUpperCase(),
    amountMinor: 10,
  };
  const paid = await store.events.pay(owner, event.id.toUpperCase(), payment);
  assert.equal(paid.participants[1].remainingMinor, 50);
  const retryPay = await store.events.pay(owner, event.id, {
    ...payment,
    clientRequestId: payNonce,
    participantId: person.id,
  });
  assert.equal(retryPay.payments.length, 1);
  assert.equal(retryPay.payments[0].id, paid.payments[0].id);
  const undoNonce = randomUUID();
  await store.events.undo(
    owner,
    event.id.toUpperCase(),
    paid.payments[0].id.toUpperCase(),
    { clientRequestId: undoNonce.toUpperCase() },
  );
  const undone = await store.events.undo(owner, event.id, paid.payments[0].id, {
    clientRequestId: undoNonce,
  });
  assert.equal(undone.payments.length, 2);
  assert.equal(undone.participants[1].remainingMinor, 60);
  assert.equal(
    (
      await store.events.create(owner, vault.vault.id, {
        ...equivalent,
        allocations: [...equivalent.allocations].reverse(),
      })
    ).payments.length,
    2,
  ); // fresh response, one existing operation
  await assert.rejects(
    store.events.create(owner, vault.vault.id, {
      ...equivalent,
      allocations: [
        { participantId: "self", shareMinor: 41 },
        { participantId: person.id, shareMinor: 59 },
      ],
    }),
    { status: 409 },
  );
  await assert.rejects(
    store.events.create(owner, vault.vault.id, {
      ...equivalent,
      participantIds: [person.id, "self"],
    }),
    { status: 409 },
  );
  await assert.rejects(
    store.events.create(
      owner,
      vault.vault.id,
      base([person.id, person.id.toUpperCase()]),
    ),
    (error) => error instanceof ZodError,
  );
  await assert.rejects(
    store.events.create(
      owner,
      vault.vault.id,
      base([person.id], { title: "Invalid\0title" }),
    ),
    (error) => error instanceof ZodError,
  );
  assert.equal((await store.events.list(owner, vault.vault.id)).length, 1);
  const otherPayer = base(["self", person.id.toUpperCase()], {
    totalMinor: 100,
    payerId: person.id.toUpperCase(),
  });
  const otherEvent = await store.events.create(
    owner,
    vault.vault.id,
    otherPayer,
  );
  assert.equal(otherEvent.payerId, person.id);
  assert.equal(otherEvent.balance.payableMinor, 50);
  assert.equal(
    (
      await store.events.create(owner, vault.vault.id, {
        ...otherPayer,
        clientRequestId: otherPayer.clientRequestId.toUpperCase(),
        participantIds: ["self", person.id],
        payerId: person.id,
      })
    ).id,
    otherEvent.id,
  );
  assert.equal(
    (await store.events.get(owner, event.id.toUpperCase())).id,
    event.id,
  );
  const archived = await store.events.archive(
    owner,
    vault.vault.id.toUpperCase(),
    true,
  );
  assert.equal(archived.vault.archived, true);
  assert.equal(archived.vault.eventCount, 2);
  await store.events.archive(owner, vault.vault.id, false);
  const equalIntent = base(["self", person.id], { totalMinor: 101 });
  const equalEvent = await store.events.create(
    owner,
    vault.vault.id,
    equalIntent,
  );
  assert.equal(equalEvent.balance.receivableMinor, 50);
  await assert.rejects(
    store.events.create(owner, vault.vault.id, {
      ...equalIntent,
      participantIds: [person.id, "self"],
    }),
    { status: 409 },
  );
  const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { authorization: "Bearer demo-lender" },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const httpInput = base(["self", person.id.toUpperCase()], {
    totalMinor: 101,
    clientRequestId: randomUUID().toUpperCase(),
    splitMode: "manual",
    allocations: [
      { participantId: person.id.toUpperCase(), shareMinor: 81 },
      { participantId: "self", shareMinor: 20 },
    ],
  });
  const route = `/v1/vaults/${vault.vault.id.toUpperCase()}/events`;
  const created = await call("POST", route, httpInput);
  assert.equal(created.statusCode, 201);
  const saved = created.json().event;
  const httpEquivalent = {
    ...httpInput,
    clientRequestId: httpInput.clientRequestId.toLowerCase(),
    participantIds: ["self", person.id],
    allocations: [
      { participantId: "self", shareMinor: 20 },
      { participantId: person.id, shareMinor: 81 },
    ],
  };
  const repeated = await call("POST", route, httpEquivalent);
  assert.equal(repeated.statusCode, 201);
  assert.equal(repeated.json().event.id, saved.id);
  assert.equal(
    (
      await call("POST", route, {
        ...httpEquivalent,
        allocations: [
          { participantId: "self", shareMinor: 21 },
          { participantId: person.id, shareMinor: 80 },
        ],
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call("POST", route, {
        ...httpEquivalent,
        participantIds: [person.id, "self"],
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call("POST", route, {
        ...httpEquivalent,
        clientRequestId: randomUUID(),
        title: "Invalid\0title",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await call("POST", route, base([person.id, person.id.toUpperCase()])))
      .statusCode,
    400,
  );

  assert.equal(
    (await call("GET", `/v1/events/${saved.id.toUpperCase()}`)).statusCode,
    200,
  );
  const httpPay = {
    clientRequestId: randomUUID().toUpperCase(),
    participantId: person.id.toUpperCase(),
    amountMinor: 1,
  };
  const httpPaid = await call(
    "POST",
    `/v1/events/${saved.id.toUpperCase()}/payments`,
    httpPay,
  );
  assert.equal(httpPaid.statusCode, 200);
  const httpUndone = await call(
    "POST",
    `/v1/events/${saved.id.toUpperCase()}/payments/${httpPaid.json().event.payments[0].id.toUpperCase()}/undo`,
    { clientRequestId: randomUUID().toUpperCase() },
  );
  assert.equal(httpUndone.statusCode, 200);
  const httpRetried = await call("POST", `/v1/events/${saved.id}/payments`, {
    ...httpPay,
    clientRequestId: httpPay.clientRequestId.toLowerCase(),
    participantId: person.id,
  });
  assert.equal(httpRetried.statusCode, 200);
  assert.equal(httpRetried.json().event.payments.length, 2);
}
test("memory event routes preserve UUID case identity and semantic manual retry equivalence", async () => {
  const store = new MemoryStore();
  const app = await buildApp({ store, auth: demoAuth(), demo: true });
  try {
    await reviewInvariantCases(store, app);
  } finally {
    await app.close();
  }
});
test("SQL event routes preserve UUID case identity and semantic manual retry equivalence", async () => {
  const { db, store } = await sqlFixture();
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    for (const file of [
      "001_initial.sql",
      "002_people_vaults.sql",
      "003_account_events.sql",
      "004_event_partial_payments.sql",
    ])
      await db.exec(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    app = await buildApp({ store, auth: demoAuth(), demo: true });
    await reviewInvariantCases(store, app);
  } finally {
    if (app) await app.close();
    else await store.close();
  }
});
