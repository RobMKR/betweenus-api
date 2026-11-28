-- ISO 4217 List One dated 2026-09-17, excluding fund and non-monetary codes.
CREATE TABLE currencies (
 code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
 minor_units SMALLINT NOT NULL CHECK (minor_units BETWEEN 0 AND 4)
);
INSERT INTO currencies(code, minor_units) VALUES
 ('AED', 2), ('AFN', 2), ('ALL', 2), ('AMD', 2), ('AOA', 2), ('ARS', 2),
 ('AUD', 2), ('AWG', 2), ('AZN', 2), ('BAM', 2), ('BBD', 2), ('BDT', 2),
 ('BHD', 3), ('BIF', 0), ('BMD', 2), ('BND', 2), ('BOB', 2), ('BRL', 2),
 ('BSD', 2), ('BTN', 2), ('BWP', 2), ('BYN', 2), ('BZD', 2), ('CAD', 2),
 ('CDF', 2), ('CHF', 2), ('CLP', 0), ('CNY', 2), ('COP', 2), ('CRC', 2),
 ('CUP', 2), ('CVE', 2), ('CZK', 2), ('DJF', 0), ('DKK', 2), ('DOP', 2),
 ('DZD', 2), ('EGP', 2), ('ERN', 2), ('ETB', 2), ('EUR', 2), ('FJD', 2),
 ('FKP', 2), ('GBP', 2), ('GEL', 2), ('GHS', 2), ('GIP', 2), ('GMD', 2),
 ('GNF', 0), ('GTQ', 2), ('GYD', 2), ('HKD', 2), ('HNL', 2), ('HTG', 2),
 ('HUF', 2), ('IDR', 2), ('ILS', 2), ('INR', 2), ('IQD', 3), ('IRR', 2),
 ('ISK', 0), ('JMD', 2), ('JOD', 3), ('JPY', 0), ('KES', 2), ('KGS', 2),
 ('KHR', 2), ('KMF', 0), ('KPW', 2), ('KRW', 0), ('KWD', 3), ('KYD', 2),
 ('KZT', 2), ('LAK', 2), ('LBP', 2), ('LKR', 2), ('LRD', 2), ('LSL', 2),
 ('LYD', 3), ('MAD', 2), ('MDL', 2), ('MGA', 2), ('MKD', 2), ('MMK', 2),
 ('MNT', 2), ('MOP', 2), ('MRU', 2), ('MUR', 2), ('MVR', 2), ('MWK', 2),
 ('MXN', 2), ('MYR', 2), ('MZN', 2), ('NAD', 2), ('NGN', 2), ('NIO', 2),
 ('NOK', 2), ('NPR', 2), ('NZD', 2), ('OMR', 3), ('PAB', 2), ('PEN', 2),
 ('PGK', 2), ('PHP', 2), ('PKR', 2), ('PLN', 2), ('PYG', 0), ('QAR', 2),
 ('RON', 2), ('RSD', 2), ('RUB', 2), ('RWF', 0), ('SAR', 2), ('SBD', 2),
 ('SCR', 2), ('SDG', 2), ('SEK', 2), ('SGD', 2), ('SHP', 2), ('SLE', 2),
 ('SOS', 2), ('SRD', 2), ('SSP', 2), ('STN', 2), ('SVC', 2), ('SYP', 2),
 ('SZL', 2), ('THB', 2), ('TJS', 2), ('TMT', 2), ('TND', 3), ('TOP', 2),
 ('TRY', 2), ('TTD', 2), ('TWD', 2), ('TZS', 2), ('UAH', 2), ('UGX', 0),
 ('USD', 2), ('UYU', 2), ('UZS', 2), ('VED', 2), ('VES', 2), ('VND', 0),
 ('VUV', 0), ('WST', 2), ('XAF', 0), ('XCD', 2), ('XCG', 2), ('XOF', 0),
 ('XPF', 0), ('YER', 2), ('ZAR', 2), ('ZMW', 2), ('ZWG', 2);

-- Existing debt/event amounts and currencies are untouched.
ALTER TABLE debts DROP CONSTRAINT debts_currency_check;
ALTER TABLE debts ADD CONSTRAINT debts_currency_fk FOREIGN KEY(currency) REFERENCES currencies(code);
ALTER TABLE vaults ADD COLUMN currency TEXT NOT NULL DEFAULT 'AED' REFERENCES currencies(code);
ALTER TABLE vaults ADD CONSTRAINT vaults_owner_id_currency_key UNIQUE(owner_id,id,currency);
ALTER TABLE vault_events DROP CONSTRAINT vault_events_currency_check;
ALTER TABLE vault_events ADD CONSTRAINT vault_events_vault_currency_fk
 FOREIGN KEY(owner_id,vault_id,currency) REFERENCES vaults(owner_id,id,currency);

ALTER TABLE vault_history DROP CONSTRAINT vault_history_action_check;
ALTER TABLE vault_history DROP CONSTRAINT vault_history_person_check;
ALTER TABLE vault_history ADD CONSTRAINT vault_history_action_check
 CHECK(action IN ('created','member_added','member_removed','archived','reactivated','currency_changed'));
ALTER TABLE vault_history ADD CONSTRAINT vault_history_person_check
 CHECK((action IN ('member_added','member_removed') AND person_id IS NOT NULL) OR
       (action IN ('created','archived','reactivated','currency_changed') AND person_id IS NULL));

CREATE TABLE currency_settings (
 owner_id TEXT PRIMARY KEY,
 main_currency TEXT NOT NULL REFERENCES currencies(code),
 rates JSONB NOT NULL CHECK (jsonb_typeof(rates) = 'array' AND jsonb_array_length(rates) <= 500)
);
ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON currencies,currency_settings FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON currencies,currency_settings FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON currencies,currency_settings FROM authenticated;
 END IF;
END $$;
