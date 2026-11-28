import { currencySettingsInput, type CurrencySettings } from "./currency.js";
import type { Identity } from "./domain.js";
import type { SqlPool } from "./store.js";

export interface CurrencySettingsStore {
  get(user: Identity): Promise<CurrencySettings>;
  put(user: Identity, input: CurrencySettings): Promise<CurrencySettings>;
}

function defaults(): CurrencySettings {
  return { mainCurrency: "USD", rates: [] };
}

export class MemoryCurrencySettings implements CurrencySettingsStore {
  private settings = new Map<string, CurrencySettings>();

  async get(user: Identity) {
    return structuredClone(this.settings.get(user.id) ?? defaults());
  }

  async put(user: Identity, input: CurrencySettings) {
    const settings = currencySettingsInput.parse(input);
    this.settings.set(user.id, settings);
    return structuredClone(settings);
  }
}

export class PostgresCurrencySettings implements CurrencySettingsStore {
  constructor(private pool: SqlPool) {}

  async get(user: Identity) {
    const { rows } = await this.pool.query<CurrencySettings>(
      'SELECT main_currency AS "mainCurrency", rates FROM currency_settings WHERE owner_id=$1',
      [user.id],
    );
    return rows[0] ?? defaults();
  }

  async put(user: Identity, input: CurrencySettings) {
    const settings = currencySettingsInput.parse(input);
    const { rows } = await this.pool.query<CurrencySettings>(
      `INSERT INTO currency_settings(owner_id,main_currency,rates)
       VALUES($1,$2,$3::jsonb)
       ON CONFLICT(owner_id) DO UPDATE
       SET main_currency=EXCLUDED.main_currency,rates=EXCLUDED.rates
       RETURNING main_currency AS "mainCurrency",rates`,
      [user.id, settings.mainCurrency, JSON.stringify(settings.rates)],
    );
    return rows[0];
  }
}
