import { z } from "zod";

/** UUID identifiers are case-insensitive; normalize before JS lookups/deduplication. */
export const uuidInput = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

/** PostgreSQL text cannot store NUL, even when valid JSON can carry it. */
export const textInput = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !value.includes("\0"),
      "Text cannot contain NUL characters.",
    );
