import { z } from "zod";
import { email } from "./domain.js";
import { uuidInput, textInput } from "./validation.js";
import { currencyInput, type Currency } from "./currency.js";
export const personInput = z
  .object({
    name: textInput(100),
    source: z.enum(["custom", "contact"]),
    email: email.optional(),
    phone: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[+0-9() .-]+$/)
      .refine((value) => /\d/.test(value), "Phone must contain a digit.")
      .optional(),
  })
  .strict();
export const vaultInput = z
  .object({
    title: textInput(100),
    kind: z.enum(["temporary", "permanent"]),
    currency: currencyInput.optional(),
    memberIds: z
      .array(uuidInput)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Members must be distinct.",
      ),
  })
  .strict();
export const memberInput = z.object({ personId: uuidInput }).strict();
export type PersonInput = z.infer<typeof personInput>;
export type VaultInput = z.infer<typeof vaultInput>;
export type SavedPerson = {
  id: string;
  name: string;
  source: "custom" | "contact";
  email: string | null;
  phone: string | null;
  createdAt: string;
};
export type Vault = {
  id: string;
  title: string;
  kind: "temporary" | "permanent";
  currency: Currency;
  archived: boolean;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
};
export type VaultHistory = {
  id: string;
  action:
    | "created"
    | "member_added"
    | "member_removed"
    | "archived"
    | "reactivated"
    | "currency_changed";
  personId: string | null;
  actorId: string;
  createdAt: string;
};
export type VaultDetail = {
  vault: Vault;
  members: SavedPerson[];
  history: VaultHistory[];
};
