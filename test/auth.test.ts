import { test } from "node:test";
import assert from "node:assert/strict";
import { supabaseAuth } from "../src/auth.js";

test("real auth rejects fabricated tokens before any identity is trusted", async () => {
  const auth = supabaseAuth("https://example.supabase.co", "not-a-real-key");
  for (const token of [
    "demo-lender",
    "john@example.com",
    "e30.eyJzdWIiOiJqb2huIiwiZW1haWwiOiJqb2huQGV4YW1wbGUuY29tIn0.fake",
  ])
    await assert.rejects(auth(token), { status: 401 });
});
