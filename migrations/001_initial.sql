CREATE TABLE debts (
 id UUID PRIMARY KEY,
 lender_id TEXT NOT NULL,
 lender_email TEXT NOT NULL,
 borrower_email TEXT NOT NULL,
 borrower_id TEXT,
 status TEXT NOT NULL CHECK (status IN ('pending','accepted','disputed')),
 amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000),
 currency TEXT NOT NULL CHECK (currency='AED'),
 description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
 created_at TIMESTAMPTZ NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL,
 history JSONB NOT NULL CHECK (jsonb_typeof(history)='array'),
 CHECK (lender_email<>borrower_email),
 CHECK ((status='pending' AND borrower_id IS NULL) OR (status IN ('accepted','disputed') AND borrower_id IS NOT NULL))
);
CREATE INDEX debts_lender_idx ON debts (lender_id);
CREATE INDEX debts_borrower_idx ON debts (borrower_id);
CREATE INDEX debts_pending_email_idx ON debts (borrower_email) WHERE borrower_id IS NULL;

-- API connects using a trusted owner role; no direct browser access is permitted.
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON debts FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON debts FROM authenticated;
 END IF;
END $$;
