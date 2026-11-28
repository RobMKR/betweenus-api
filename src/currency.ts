import { z } from "zod";
import catalog from "./currency-catalog.json" with { type: "json" };

export type Currency = keyof typeof catalog;
export const legacyCurrency: Currency = "AED";
export const currencyInput = z.custom<Currency>(
  (value) => typeof value === "string" && Object.hasOwn(catalog, value),
  "Use a supported uppercase ISO 4217 currency code.",
);
export const vaultCurrencyInput = z
  .object({ currency: currencyInput })
  .strict();

export type CurrencyBalance = {
  currency: Currency;
  receivableMinor: number;
  payableMinor: number;
  netMinor: number;
};

export function emptyBalance(currency: Currency): CurrencyBalance {
  return { currency, receivableMinor: 0, payableMinor: 0, netMinor: 0 };
}

export function aggregateBalances(
  entries: Iterable<Omit<CurrencyBalance, "netMinor">>,
  fallback: Currency = legacyCurrency,
): CurrencyBalance[] {
  const balances = new Map<Currency, CurrencyBalance>();
  for (const entry of entries) {
    const balance =
      balances.get(entry.currency) ?? emptyBalance(entry.currency);
    balance.receivableMinor += entry.receivableMinor;
    balance.payableMinor += entry.payableMinor;
    if (
      !Number.isSafeInteger(balance.receivableMinor) ||
      !Number.isSafeInteger(balance.payableMinor)
    )
      throw new RangeError("Original balance exceeds the safe integer limit.");
    balance.netMinor = balance.receivableMinor - balance.payableMinor;
    balances.set(entry.currency, balance);
  }
  return balances.size
    ? [...balances.values()].sort((a, b) =>
        a.currency.localeCompare(b.currency),
      )
    : [emptyBalance(fallback)];
}

type Ratio = { numerator: bigint; denominator: bigint };

function decimal(value: string): Ratio {
  const [whole, fraction = ""] = value.split(".");
  return {
    numerator: BigInt(whole + fraction),
    denominator: 10n ** BigInt(fraction.length),
  };
}

function pairKey(base: Currency, quote: Currency) {
  return [base, quote].sort().join("/");
}

const suggestedRates: Record<string, string> = {
  "USD/AED": "3.6725",
  "USD/QAR": "3.64",
  "OMR/USD": "2.6008",
  "USD/BHD": "0.376",
};

const rateValue = z
  .string()
  .max(23)
  .refine((value) => {
    if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,12})?$/.test(value)) return false;
    const rate = decimal(value);
    return (
      rate.numerator > 0n && rate.numerator <= 1_000_000_000n * rate.denominator
    );
  }, "Use a positive plain decimal at most 1000000000 with up to 12 decimal places.");

const rateInput = z
  .object({
    baseCurrency: currencyInput,
    quoteCurrency: currencyInput,
    rate: rateValue,
    source: z.enum(["manual", "suggested"]),
    asOf: z.string().max(30).datetime(),
  })
  .strict();

export const currencySettingsInput = z
  .object({ mainCurrency: currencyInput, rates: z.array(rateInput).max(500) })
  .strict()
  .superRefine(({ rates }, context) => {
    const seen = new Set<string>();
    rates.forEach((quote, index) => {
      const { baseCurrency, quoteCurrency, rate, source } = quote;
      const key = pairKey(baseCurrency, quoteCurrency);
      let message: string | undefined;
      if (baseCurrency === quoteCurrency)
        message = "Choose two distinct currencies.";
      else if (seen.has(key))
        message = "This currency pair already has a quote.";
      else if (
        source === "suggested" &&
        suggestedRates[`${baseCurrency}/${quoteCurrency}`] !== rate
      )
        message = "The quote does not match a supported peg suggestion.";
      if (message)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rates", index],
          message,
        });
      seen.add(key);
    });
  });

export type CurrencySettings = z.infer<typeof currencySettingsInput>;

function add(left: Ratio, right: Ratio): Ratio {
  return {
    numerator:
      left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  };
}

function multiply(left: Ratio, right: Ratio): Ratio {
  return {
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator,
  };
}

function rounded({ numerator, denominator }: Ratio): string {
  const magnitude = numerator < 0n ? -numerator : numerator;
  const nearest = (2n * magnitude + denominator) / (2n * denominator);
  return String(numerator < 0n ? -nearest : nearest);
}

export function valueBalances(
  balances: CurrencyBalance[],
  settings: CurrencySettings,
) {
  const { mainCurrency: currency, rates } = settings;
  const byPair = new Map(
    rates.map((quote) => [
      pairKey(quote.baseCurrency, quote.quoteCurrency),
      quote,
    ]),
  );
  function direct(from: Currency, to: Currency): Ratio | undefined {
    const quote = byPair.get(pairKey(from, to));
    if (!quote) return undefined;
    const rate = decimal(quote.rate);
    return from === quote.baseCurrency
      ? rate
      : { numerator: rate.denominator, denominator: rate.numerator };
  }
  function ratio(from: Currency) {
    if (from === currency) return { numerator: 1n, denominator: 1n };
    const directRate = direct(from, currency);
    if (directRate) return directRate;
    const fromUsdLeg = direct(from, "USD");
    const toUsdLeg = direct("USD", currency);
    return fromUsdLeg && toUsdLeg ? multiply(fromUsdLeg, toUsdLeg) : undefined;
  }
  const missingCurrencies: Currency[] = [];
  let receivable = { numerator: 0n, denominator: 1n };
  let payable = { numerator: 0n, denominator: 1n };
  for (const row of balances) {
    if (!row.receivableMinor && !row.payableMinor) continue;
    const rate = ratio(row.currency);
    if (!rate) {
      missingCurrencies.push(row.currency);
      continue;
    }
    const scale = multiply(rate, {
      numerator: 10n ** BigInt(catalog[currency].minorUnits),
      denominator: 10n ** BigInt(catalog[row.currency].minorUnits),
    });
    receivable = add(receivable, {
      ...scale,
      numerator: BigInt(row.receivableMinor) * scale.numerator,
    });
    payable = add(payable, {
      ...scale,
      numerator: BigInt(row.payableMinor) * scale.numerator,
    });
  }
  return {
    currency,
    receivableMinor: rounded(receivable),
    payableMinor: rounded(payable),
    netMinor: rounded(
      add(receivable, { ...payable, numerator: -payable.numerator }),
    ),
    incomplete: missingCurrencies.length > 0,
    missingCurrencies,
  };
}
