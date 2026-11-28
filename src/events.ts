import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./domain.js";
import type { SavedPerson, Vault, VaultDetail } from "./directory.js";
import { uuidInput, textInput } from "./validation.js";
import {
  aggregateBalances,
  currencyInput,
  emptyBalance,
  type Currency,
  type CurrencyBalance,
} from "./currency.js";
export const participantRef = z.union([z.literal("self"), uuidInput]);
const minor = z.number().int().min(1).max(1_000_000_000);
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      value.slice(0, 4) !== "0000" &&
      Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    "Use a real calendar date in YYYY-MM-DD format.",
  );
export const eventInput = z
  .object({
    clientRequestId: uuidInput,
    title: textInput(200),
    date: calendarDate,
    currency: currencyInput,
    totalMinor: minor,
    participantIds: z.array(participantRef).min(1).max(100),
    payerId: participantRef,
    splitMode: z.enum(["equal", "manual"]),
    allocations: z
      .array(
        z
          .object({
            participantId: participantRef,
            shareMinor: z.number().int().min(0).max(1_000_000_000),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    // Keep omission in the parsed intent so old create fingerprints match.
    partialPayments: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, message });
    if (new Set(input.participantIds).size !== input.participantIds.length)
      issue("Participants must be distinct.");
    if (
      input.payerId !== "self" &&
      !input.participantIds.includes(input.payerId)
    )
      issue("A nonself payer must be a selected participant.");
    if (input.splitMode === "equal") {
      if (input.allocations !== undefined)
        issue("Equal mode does not accept manual allocations.");
    } else if (
      !input.allocations ||
      input.allocations.length !== input.participantIds.length ||
      new Set(input.allocations.map((a) => a.participantId)).size !==
        input.participantIds.length ||
      input.allocations.some(
        (a) => !input.participantIds.includes(a.participantId),
      ) ||
      input.allocations.reduce((sum, a) => sum + a.shareMinor, 0) !==
        input.totalMinor
    )
      issue(
        "Manual allocations must cover each selected participant exactly once and sum to the total.",
      );
  })
  .transform((input) =>
    input.splitMode === "manual"
      ? {
          ...input,
          // Allocation rows are a mapping; participant order remains meaningful.
          allocations: input.participantIds.map((participantId) =>
            input.allocations!.find(
              (row) => row.participantId === participantId,
            )!,
          ),
        }
      : input,
  );
export const paymentInput = z
  .object({
    clientRequestId: uuidInput,
    participantId: participantRef,
    amountMinor: minor,
  })
  .strict();
export const undoInput = z.object({ clientRequestId: uuidInput }).strict();
export const archiveInput = z.object({ archived: z.boolean() }).strict();
export type EventInput = z.infer<typeof eventInput>;
export type PaymentInput = z.infer<typeof paymentInput>;
export type UndoInput = z.infer<typeof undoInput>;
export type PrivateBalance = CurrencyBalance;
export type Participant = {
  participantId: string;
  name: string;
  isSelf: boolean;
  shareMinor: number;
};
export type EventPayment = {
  id: string;
  participantId: string;
  amountMinor: number;
  createdAt: string;
  reversesId?: string;
};
export type StoredEvent = {
  id: string;
  vaultId: string;
  title: string;
  date: string;
  currency: Currency;
  totalMinor: number;
  payerId: string;
  splitMode: "equal" | "manual";
  partialPayments: boolean;
  participants: Participant[];
  payments: EventPayment[];
  createdAt: string;
  updatedAt: string;
};
export type AccountEvent = Omit<StoredEvent, "participants"> & {
  participants: Array<Participant & { remainingMinor: number }>;
  balance: PrivateBalance;
};
export type VaultSummary = Vault & {
  eventCount: number;
  balances: PrivateBalance[];
};
export type VaultSummaryDetail = Omit<VaultDetail, "vault"> & {
  vault: VaultSummary;
};
export const missingEvent = () =>
  new ApiError(404, "NOT_FOUND", "Event, vault or participant not found.");
export function requireActive(archived: boolean) {
  if (archived)
    throw new ApiError(
      409,
      "VAULT_ARCHIVED",
      "Reactivate this vault before changing events or payments.",
    );
}
export function requireVaultCurrency(
  vaultCurrency: Currency,
  eventCurrency: Currency,
) {
  if (vaultCurrency !== eventCurrency)
    throw new ApiError(
      409,
      "VAULT_CURRENCY_MISMATCH",
      "Event currency must match the vault currency.",
    );
}
export function viewEvent(event: StoredEvent): AccountEvent {
  const participants = event.participants.map((person) => ({
    ...person,
    remainingMinor:
      person.participantId === event.payerId
        ? 0
        : person.shareMinor -
          event.payments
            .filter((payment) => payment.participantId === person.participantId)
            .reduce((sum, payment) => sum + payment.amountMinor, 0),
  }));
  const balance = emptyBalance(event.currency);
  if (event.payerId === "self")
    balance.receivableMinor = participants
      .filter((p) => !p.isSelf)
      .reduce((sum, p) => sum + p.remainingMinor, 0);
  else
    balance.payableMinor =
      participants.find((p) => p.isSelf)?.remainingMinor ?? 0;
  balance.netMinor = balance.receivableMinor - balance.payableMinor;
  return { ...structuredClone(event), participants, balance };
}
export function privateBalances(
  events: AccountEvent[],
  fallback?: Currency,
): PrivateBalance[] {
  return aggregateBalances(
    events.map((event) => event.balance),
    fallback,
  );
}
export function summarize(vault: Vault, events: AccountEvent[]): VaultSummary {
  const selected = events.filter((event) => event.vaultId === vault.id);
  // An event can be committed after the directory read. Its currency is the
  // definitive currency once a vault has activity.
  const currency = selected[0]?.currency ?? vault.currency;
  return {
    ...structuredClone(vault),
    currency,
    eventCount: selected.length,
    balances: privateBalances(selected, currency),
  };
}
export function makeEvent(
  vaultId: string,
  input: EventInput,
  people: Array<Pick<SavedPerson, "id" | "name">>,
): StoredEvent {
  const each = Math.floor(input.totalMinor / input.participantIds.length),
    extra = input.totalMinor % input.participantIds.length;
  const participants = input.participantIds.map((participantId, index) => {
    const person = people.find((person) => person.id === participantId);
    if (participantId !== "self" && !person) throw missingEvent();
    return {
      participantId,
      name: participantId === "self" ? "Me" : person!.name,
      isSelf: participantId === "self",
      shareMinor:
        input.splitMode === "equal"
          ? each + (index < extra ? 1 : 0)
          : input.allocations!.find(
              (allocation) => allocation.participantId === participantId,
            )!.shareMinor,
    };
  });
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    vaultId,
    title: input.title,
    date: input.date,
    currency: input.currency,
    totalMinor: input.totalMinor,
    payerId: input.payerId,
    splitMode: input.splitMode,
    partialPayments: input.partialPayments ?? true,
    participants,
    payments: [],
    createdAt: now,
    updatedAt: now,
  };
}
export function recordPayment(
  event: StoredEvent,
  input: PaymentInput,
): StoredEvent {
  const participant = viewEvent(event).participants.find(
    (person) => person.participantId === input.participantId,
  );
  if (!participant) throw missingEvent();
  if (participant.participantId === event.payerId)
    throw new ApiError(
      409,
      "PAYER_PAYMENT",
      "The payer does not owe their own share.",
    );
  if (input.amountMinor > participant.remainingMinor)
    throw new ApiError(
      409,
      "OVERPAYMENT",
      "Payment exceeds the remaining amount.",
    );
  if (
    !event.partialPayments &&
    input.amountMinor !== participant.remainingMinor
  )
    throw new ApiError(
      409,
      "FULL_PAYMENT_REQUIRED",
      "Payment must equal the remaining amount.",
    );
  const payment: EventPayment = {
    id: randomUUID(),
    participantId: input.participantId,
    amountMinor: input.amountMinor,
    createdAt: new Date().toISOString(),
  };
  return {
    ...event,
    payments: [...event.payments, payment],
    updatedAt: payment.createdAt,
  };
}
export function reversePayment(
  event: StoredEvent,
  paymentId: string,
): StoredEvent {
  const original = event.payments.find((payment) => payment.id === paymentId);
  if (!original) throw missingEvent();
  if (
    original.amountMinor <= 0 ||
    event.payments.some((payment) => payment.reversesId === paymentId)
  )
    throw new ApiError(
      409,
      "ALREADY_REVERSED",
      "Only an unreversed positive payment can be undone.",
    );
  const payment: EventPayment = {
    id: randomUUID(),
    participantId: original.participantId,
    amountMinor: -original.amountMinor,
    createdAt: new Date().toISOString(),
    reversesId: original.id,
  };
  return {
    ...event,
    payments: [...event.payments, payment],
    updatedAt: payment.createdAt,
  };
}
