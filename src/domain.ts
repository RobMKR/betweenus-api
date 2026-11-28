import { randomUUID } from "node:crypto";
import { z } from "zod";
import { aggregateBalances, currencyInput, type Currency } from "./currency.js";
export type Identity = { id: string; email: string };
export type Debt = {
  id: string;
  lenderId: string;
  lenderEmail: string;
  borrowerEmail: string;
  borrowerId: string | null;
  status: "pending" | "accepted" | "disputed";
  amountMinor: number;
  currency: Currency;
  description: string;
  createdAt: string;
  updatedAt: string;
  history: {
    id: string;
    action: "created" | "accepted" | "disputed";
    actorId: string;
    createdAt: string;
    reason?: string;
  }[];
};
export const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const createInput = z
  .object({
    borrowerEmail: email,
    amountMinor: z.number().int().positive().max(1_000_000_000),
    currency: currencyInput,
    description: z.string().trim().min(1).max(500),
  })
  .strict();
export const disputeInput = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function visible(d: Debt, u: Identity) {
  return (
    d.lenderId === u.id ||
    (d.borrowerId ? d.borrowerId === u.id : d.borrowerEmail === u.email)
  );
}
export function createDebt(
  input: z.infer<typeof createInput>,
  u: Identity,
): Debt {
  if (input.borrowerEmail === u.email)
    throw new ApiError(400, "SELF_DEBT", "You cannot invite yourself.");
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    lenderId: u.id,
    lenderEmail: u.email,
    borrowerId: null,
    ...input,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    history: [
      { id: randomUUID(), action: "created", actorId: u.id, createdAt: now },
    ],
  };
}
export function transition(
  d: Debt | undefined,
  u: Identity,
  action: "accepted" | "disputed",
  reason?: string,
): Debt {
  if (!d || !visible(d, u))
    throw new ApiError(404, "NOT_FOUND", "Debt not found.");
  if (
    (d.borrowerId ? d.borrowerId !== u.id : d.borrowerEmail !== u.email) ||
    d.lenderId === u.id
  )
    throw new ApiError(
      403,
      "BORROWER_REQUIRED",
      "Only the invited verified borrower can respond.",
    );
  if (d.status !== "pending")
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      "This request has already been answered.",
    );
  const now = new Date().toISOString();
  return {
    ...d,
    borrowerId: u.id,
    status: action,
    updatedAt: now,
    history: [
      ...d.history,
      {
        id: randomUUID(),
        action,
        actorId: u.id,
        createdAt: now,
        ...(reason ? { reason } : {}),
      },
    ],
  };
}
export function balances(debts: Debt[], u: Identity) {
  return aggregateBalances(
    debts
      .filter(
        (debt) =>
          debt.status === "accepted" &&
          (debt.lenderId === u.id || debt.borrowerId === u.id),
      )
      .map((debt) => ({
        currency: debt.currency,
        receivableMinor: debt.lenderId === u.id ? debt.amountMinor : 0,
        payableMinor: debt.borrowerId === u.id ? debt.amountMinor : 0,
      })),
  );
}
