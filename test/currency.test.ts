import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buildApp } from "../src/app.js";
import {
  aggregateBalances,
  currencySettingsInput,
  valueBalances,
  type Currency,
  type CurrencyBalance,
  type CurrencySettings,
} from "../src/currency.js";
import type { Identity } from "../src/domain.js";
import { MemoryStore, PostgresStore, type Store } from "../src/store.js";

const owner = { id: "currency-owner", email: "currency-owner@example.invalid" };
const other = { id: "currency-other", email: "currency-other@example.invalid" };

function rate(
  baseCurrency: Currency,
  quoteCurrency: Currency,
  value: string,
  source: CurrencySettings["rates"][number]["source"] = "manual",
): CurrencySettings["rates"][number] {
  return {
    baseCurrency,
    quoteCurrency,
    rate: value,
    source,
    asOf: "2026-11-28T00:00:00.000Z",
  };
}

function balance(
  currency: Currency,
  receivableMinor: number,
  payableMinor = 0,
): CurrencyBalance {
  return {
    currency,
    receivableMinor,
    payableMinor,
    netMinor: receivableMinor - payableMinor,
  };
}

test("valuation prefers direct pairs, supports reverse quotes and triangulation, and preserves directions", () => {
  const aed = rate("USD", "AED", "3.6725", "suggested");
  assert.deepEqual(
    valueBalances([balance("USD", 10000)], {
      mainCurrency: "AED",
      rates: [aed],
    }),
    {
      currency: "AED",
      receivableMinor: "36725",
      payableMinor: "0",
      netMinor: "36725",
      incomplete: false,
      missingCurrencies: [],
    },
  );
  const usd = valueBalances([balance("AED", 36725)], {
    mainCurrency: "USD",
    rates: [aed],
  });
  assert.equal(usd.receivableMinor, "10000");
  const rates = [aed, rate("USD", "RUB", "100")];
  const original = [
    balance("AED", 36725),
    balance("JPY", 123),
    balance("GBP", 0),
  ];
  assert.equal(
    valueBalances(original, { mainCurrency: "RUB", rates }).receivableMinor,
    "1000000",
  );
  for (const custom of [rate("RUB", "AED", "0.04"), rate("AED", "RUB", "25")]) {
    const result = valueBalances(original, {
      mainCurrency: "RUB",
      rates: [...rates, custom],
    });
    assert.equal(result.receivableMinor, "918125");
    assert.equal(result.incomplete, true);
    assert.deepEqual(result.missingCurrencies, ["JPY"]);
  }
});

test("valuation uses ISO exponents, rounds exact aggregate and net, and does not narrow big results", () => {
  const result = valueBalances(
    [balance("JPY", 1), balance("BHD", 4), balance("OMR", 4)],
    {
      mainCurrency: "USD",
      rates: [
        rate("JPY", "USD", "0.004"),
        rate("BHD", "USD", "1"),
        rate("OMR", "USD", "1"),
      ],
    },
  );
  assert.equal(result.receivableMinor, "1");
  const half = valueBalances([balance("BHD", 0, 5)], {
    mainCurrency: "USD",
    rates: [rate("BHD", "USD", "1")],
  });
  assert.equal(half.payableMinor, "1");
  assert.equal(half.netMinor, "-1");
  const large = valueBalances([balance("JPY", 1_000_000_000)], {
    mainCurrency: "BHD",
    rates: [rate("JPY", "BHD", "1000000000")],
  });
  assert.equal(large.receivableMinor, "1000000000000000000000");
  assert.throws(
    () =>
      aggregateBalances([
        balance("USD", Number.MAX_SAFE_INTEGER),
        balance("USD", 1),
      ]),
    RangeError,
  );
});

test("currency settings reject invalid codes, quotes, switch directions, and metadata", () => {
  const valid = rate("USD", "AED", "3.6725", "suggested");
  assert.equal(
    currencySettingsInput.safeParse({ mainCurrency: "USD", rates: [valid] })
      .success,
    true,
  );
  const supportedSuggestions = [
    rate("USD", "QAR", "3.64", "suggested"),
    rate("OMR", "USD", "2.6008", "suggested"),
    rate("USD", "BHD", "0.376", "suggested"),
  ];
  assert.equal(
    currencySettingsInput.safeParse({
      mainCurrency: "JPY",
      rates: supportedSuggestions,
    }).success,
    true,
  );
  const invalid = [
    ...[
      0,
      -1,
      3.6725,
      "0",
      "Infinity",
      "NaN",
      "1e2",
      "-1",
      ".5",
      " 1 ",
      "01",
      "1.0000000000001",
      "1000000000.000000000001",
    ].map((value) => [{ ...valid, source: "manual", rate: value }]),
    [{ ...valid, asOf: "2026-02-30T00:00:00Z" }],
    [{ ...valid, asOf: "2026-11-28T00:00:00+04:00" }],
    [{ ...valid, quoteCurrency: "USD" }],
    [{ ...valid, quoteCurrency: "XAU" }],
    [{ ...valid, source: "provider" }],
    [{ ...valid, rate: "3.67" }],
    [valid, valid],
    [valid, rate("AED", "USD", "0.3")],
    Array(501).fill(valid),
    [{ ...valid, ownerId: other.id }],
  ];
  for (const rates of invalid)
    assert.equal(
      currencySettingsInput.safeParse({ mainCurrency: "USD", rates }).success,
      false,
    );
  for (const mainCurrency of ["XAU", "CLF", "XXX", "aed", "__proto__", null])
    assert.equal(
      currencySettingsInput.safeParse({ mainCurrency, rates: [] }).success,
      false,
    );
});

test("authenticated currency routes isolate settings and preserve ledger history when changing valuation", async () => {
  const store = new MemoryStore();
  const app = await buildApp({
    store,
    auth: async (token) => (token === "other" ? other : owner),
  });
  const call = (
    method: "GET" | "POST" | "PATCH" | "PUT",
    url: string,
    payload?: object,
    token = "owner",
  ) =>
    app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${token}` },
    });

  try {
    const settingsPath = "/v1/currency-settings";
    assert.equal((await app.inject({ url: settingsPath })).statusCode, 401);
    assert.deepEqual((await call("GET", settingsPath)).json(), {
      mainCurrency: "USD",
      rates: [],
    });
    const settings = {
      mainCurrency: "AED",
      rates: [rate("USD", "AED", "3.6725", "suggested")],
    };
    assert.deepEqual(
      (await call("PUT", settingsPath, settings)).json(),
      settings,
    );
    assert.deepEqual(
      (await call("GET", settingsPath, undefined, "other")).json(),
      { mainCurrency: "USD", rates: [] },
    );
    const invalid = await call("PUT", settingsPath, {
      ...settings,
      rates: [...settings.rates, rate("AED", "USD", "0.3")],
    });
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual((await call("GET", settingsPath)).json(), settings);

    const debtInput = {
      borrowerEmail: other.email,
      currency: "USD",
      amountMinor: 10000,
      description: "Test",
    };
    const accepted = (await call("POST", "/v1/debts", debtInput)).json().debt;
    await call("POST", `/v1/debts/${accepted.id}/accept`, {}, "other");
    await call("POST", "/v1/debts", { ...debtInput, currency: "RUB" });
    const before = (await call("GET", "/v1/debts")).json();

    const vault = (
      await call("POST", "/v1/vaults", {
        title: "Trip",
        kind: "temporary",
        currency: "JPY",
        memberIds: [],
      })
    ).json().vault;
    const vaultPath = `/v1/vaults/${vault.id}`;
    assert.deepEqual(vault.balances, [balance("JPY", 0)]);
    assert.equal(
      (
        await call(
          "PATCH",
          vaultPath + "/currency",
          { currency: "BHD" },
          "other",
        )
      ).statusCode,
      404,
    );
    const changed = (
      await call("PATCH", vaultPath + "/currency", { currency: "BHD" })
    ).json();
    assert.equal(changed.vault.currency, "BHD");
    assert.equal(changed.history.at(-1).action, "currency_changed");
    assert.deepEqual(
      (
        await call("PATCH", vaultPath + "/currency", { currency: "BHD" })
      ).json(),
      changed,
    );

    const person = await store.directory.createPerson(owner, {
      name: "Friend",
      source: "custom",
    });
    const event = {
      clientRequestId: randomUUID(),
      title: "Event",
      date: "2026-11-28",
      totalMinor: 11,
      participantIds: ["self", person.id],
      payerId: "self",
      splitMode: "equal",
      currency: "JPY",
    };
    const mismatch = await call("POST", vaultPath + "/events", event);
    assert.equal(mismatch.statusCode, 409);
    assert.equal(mismatch.json().error.code, "VAULT_CURRENCY_MISMATCH");
    const saved = (
      await call("POST", vaultPath + "/events", { ...event, currency: "BHD" })
    ).json().event;
    assert.deepEqual(
      saved.participants.map(
        (participant: { shareMinor: number }) => participant.shareMinor,
      ),
      [6, 5],
    );
    const locked = await call("PATCH", vaultPath + "/currency", {
      currency: "JPY",
    });
    assert.equal(locked.statusCode, 409);
    assert.equal(locked.json().error.code, "VAULT_CURRENCY_LOCKED");
    const conflict = await call("POST", vaultPath + "/events", event);
    assert.equal(conflict.json().error.code, "IDEMPOTENCY_CONFLICT");

    const balances = (await call("GET", "/v1/balances")).json();
    assert.deepEqual(balances.balances, [balance("USD", 10000)]);
    assert.equal(balances.valuation.receivableMinor, "36725");
    const privateBalances = (await call("GET", "/v1/vault-balances")).json();
    assert.deepEqual(privateBalances.balances, [balance("BHD", 5)]);
    assert.deepEqual(privateBalances.valuation.missingCurrencies, ["BHD"]);
    const paid = (
      await call("POST", `/v1/events/${saved.id}/payments`, {
        clientRequestId: randomUUID(),
        participantId: person.id,
        amountMinor: 5,
      })
    ).json().event;
    const undo = (
      await call(
        "POST",
        `/v1/events/${saved.id}/payments/${paid.payments[0].id}/undo`,
        { clientRequestId: randomUUID() },
      )
    ).json().event;
    assert.equal(undo.balance.receivableMinor, 5);
    assert.equal(undo.currency, "BHD");

    await call("PUT", settingsPath, { mainCurrency: "USD", rates: [] });
    assert.deepEqual((await call("GET", "/v1/debts")).json(), before);
    assert.deepEqual(
      (await call("GET", `/v1/events/${saved.id}`)).json().event,
      undo,
    );
    assert.equal(
      (await call("GET", "/v1/balances")).json().valuation.receivableMinor,
      "10000",
    );
    assert.deepEqual(
      (await call("GET", "/v1/vault-balances", undefined, "other")).json()
        .balances,
      [balance("AED", 0)],
    );
  } finally {
    await app.close();
  }
});

async function competingWrites(store: Store, user: Identity) {
  const person = await store.directory.createPerson(user, {
    name: "Guest",
    source: "custom",
  });
  for (let iteration = 0; iteration < 4; iteration++) {
    const { vault } = await store.directory.createVault(user, {
      title: "Concurrency",
      kind: "temporary",
      memberIds: [],
      currency: "BHD",
    });
    const intent = {
      clientRequestId: randomUUID(),
      title: "Dinner",
      date: "2026-11-28",
      totalMinor: 100,
      participantIds: [person.id],
      payerId: "self",
      splitMode: "equal" as const,
      currency: "BHD" as const,
    };
    const create = () => store.events.create(user, vault.id, intent);
    const change = () => store.events.changeCurrency(user, vault.id, "JPY");
    const race = await Promise.allSettled(
      iteration % 2 === 0 ? [create(), change()] : [change(), create()],
    );
    assert.equal(
      race.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const reloaded = await store.directory.vault(user, vault.id);
    const [event] = await store.events.list(user, vault.id);
    const failed = race.find((result) => result.status === "rejected");
    if (event) {
      assert.equal(reloaded.vault.currency, "BHD");
      assert.equal(failed?.reason.code, "VAULT_CURRENCY_LOCKED");
      assert.deepEqual(await create(), event);
    } else {
      assert.equal(reloaded.vault.currency, "JPY");
      assert.equal(failed?.reason.code, "VAULT_CURRENCY_MISMATCH");
      const corrected = await store.events.create(user, vault.id, {
        ...intent,
        currency: "JPY",
      });
      assert.equal(corrected.currency, "JPY");
    }
  }
}

test("memory vault currency edits serialize with event creation", async () => {
  const store = new MemoryStore();
  await competingWrites(store, owner);
});

test(
  "PostgreSQL vault row locks serialize currency edits with event creation",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const connectionString = process.env.DATABASE_URL!;
    const store = new PostgresStore(connectionString);
    const user = { id: `currency-test-${randomUUID()}`, email: owner.email };
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      await competingWrites(store, user);
    } finally {
      try {
        await client.query("BEGIN");
        for (const table of [
          "event_requests",
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
