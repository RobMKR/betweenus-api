import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { demoAuth } from "../src/auth.js";
import { MemoryStore } from "../src/store.js";
async function fixture() {
  const app = await buildApp({
    store: new MemoryStore(),
    auth: demoAuth(),
    demo: true,
  });
  const request = (
    method: "GET" | "POST",
    url: string,
    token = "demo-lender",
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  return { app, request };
}
const input = {
  borrowerEmail: "john@example.com",
  amountMinor: 12550,
  currency: "AED",
  description: "Dinner",
};
test("authorization isolates debts and only invited borrower accepts", async () => {
  const { app, request } = await fixture();
  try {
    assert.equal(
      (await app.inject({ method: "GET", url: "/v1/debts" })).statusCode,
      401,
    );
    const created = await request("POST", "/v1/debts", "demo-lender", input);
    assert.equal(created.statusCode, 201);
    const { debt } = created.json();
    assert.equal(
      (await request("GET", "/v1/debts", "demo-other")).json().debts.length,
      0,
    );
    assert.equal(
      (await request("POST", `/v1/debts/${debt.id}/accept`, "demo-other", {}))
        .statusCode,
      404,
    );
    assert.equal(
      (await request("POST", `/v1/debts/${debt.id}/accept`, "demo-lender", {}))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await request(
          "POST",
          `/v1/debts/${debt.id}/accept`,
          "demo-borrower",
          {},
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await request(
          "POST",
          `/v1/debts/${debt.id}/accept`,
          "demo-borrower",
          {},
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await request("POST", `/v1/debts/${debt.id}/dispute`, "demo-borrower", {
          reason: "Changed mind",
        })
      ).statusCode,
      409,
    );
  } finally {
    await app.close();
  }
});
test("only accepted debts enter balances, history records dispute reason", async () => {
  const { app, request } = await fixture();
  try {
    const a = (await request("POST", "/v1/debts", "demo-lender", input)).json()
      .debt;
    const b = (
      await request("POST", "/v1/debts", "demo-lender", {
        ...input,
        amountMinor: 300,
      })
    ).json().debt;
    assert.equal(
      (await request("GET", "/v1/balances")).json().balances[0].netMinor,
      0,
    );
    assert.equal(
      (
        await request("POST", `/v1/debts/${b.id}/dispute`, "demo-borrower", {
          reason: " ",
        })
      ).statusCode,
      400,
    );
    const disputed = (
      await request("POST", `/v1/debts/${b.id}/dispute`, "demo-borrower", {
        reason: "Wrong amount",
      })
    ).json().debt;
    assert.equal(disputed.history[1].reason, "Wrong amount");
    assert.equal(disputed.borrowerId, "demo-john");
    await request("POST", `/v1/debts/${a.id}/accept`, "demo-borrower", {});
    assert.deepEqual((await request("GET", "/v1/balances")).json().balances, [
      {
        currency: "AED",
        receivableMinor: 12550,
        payableMinor: 0,
        netMinor: 12550,
      },
    ]);
    assert.equal(
      (await request("GET", "/v1/balances", "demo-borrower")).json().balances[0]
        .netMinor,
      -12550,
    );
    assert.equal(
      (await request("GET", "/v1/balances", "demo-other")).json().balances[0]
        .netMinor,
      0,
    );
  } finally {
    await app.close();
  }
});
test("validates integer money, currencies, emails, bounds and self debt", async () => {
  const { app, request } = await fixture();
  try {
    for (const patch of [
      { amountMinor: 1.5 },
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: 1_000_000_001 },
      { currency: "USD" },
      { borrowerEmail: "oops" },
      { borrowerEmail: "alex@example.com" },
      { description: "" },
      { description: "x".repeat(501) },
      { lenderId: "spoof" },
    ])
      assert.equal(
        (
          await request("POST", "/v1/debts", "demo-lender", {
            ...input,
            ...patch,
          })
        ).statusCode,
        400,
      );
    const created = (
      await request("POST", "/v1/debts", "demo-lender", {
        ...input,
        borrowerEmail: " JOHN@example.com ",
      })
    ).json().debt;
    assert.equal(created.borrowerEmail, "john@example.com");
    assert.equal(
      (await request("GET", "/v1/debts", "bad-token")).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/v1/debts",
          headers: { "x-user-email": "john@example.com" },
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});
