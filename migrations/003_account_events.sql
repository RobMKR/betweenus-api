-- Add archive history without changing existing membership/debt records.
ALTER TABLE vault_history DROP CONSTRAINT vault_history_action_check;
ALTER TABLE vault_history DROP CONSTRAINT vault_history_check;
ALTER TABLE vault_history ADD CONSTRAINT vault_history_action_check CHECK(action IN ('created','member_added','member_removed','archived','reactivated'));
ALTER TABLE vault_history ADD CONSTRAINT vault_history_person_check CHECK((action IN ('member_added','member_removed') AND person_id IS NOT NULL) OR (action IN ('created','archived','reactivated') AND person_id IS NULL));
CREATE TABLE vault_events (
 id UUID PRIMARY KEY,
 owner_id TEXT NOT NULL,
 vault_id UUID NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 event_date DATE NOT NULL CHECK(event_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date),
 currency TEXT NOT NULL CHECK(currency='AED'),
 total_minor INTEGER NOT NULL CHECK(total_minor BETWEEN 1 AND 1000000000),
 payer_id TEXT NOT NULL,
 split_mode TEXT NOT NULL CHECK(split_mode IN ('equal','manual')),
 participants JSONB NOT NULL CHECK(jsonb_typeof(participants)='array' AND jsonb_array_length(participants) BETWEEN 1 AND 100),
 created_at TIMESTAMPTZ NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL,
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,vault_id) REFERENCES vaults(owner_id,id)
);
CREATE INDEX vault_events_owner_idx ON vault_events(owner_id,vault_id,created_at,id);
CREATE TABLE event_payments (
 id UUID PRIMARY KEY,
 owner_id TEXT NOT NULL,
 event_id UUID NOT NULL,
 participant_id TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN -1000000000 AND 1000000000 AND amount_minor<>0),
 reverses_id UUID,
 created_at TIMESTAMPTZ NOT NULL,
 position BIGINT GENERATED ALWAYS AS IDENTITY,
 UNIQUE(owner_id,event_id,id),
 UNIQUE(reverses_id),
 FOREIGN KEY(owner_id,event_id) REFERENCES vault_events(owner_id,id),
 FOREIGN KEY(owner_id,event_id,reverses_id) REFERENCES event_payments(owner_id,event_id,id),
 CHECK((amount_minor>0 AND reverses_id IS NULL) OR (amount_minor<0 AND reverses_id IS NOT NULL))
);
CREATE INDEX event_payments_owner_idx ON event_payments(owner_id,event_id,position);
CREATE TABLE event_requests (
 owner_id TEXT NOT NULL,
 request_id UUID NOT NULL,
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
 action TEXT NOT NULL CHECK(action IN ('create','pay','undo')),
 resource TEXT NOT NULL,
 event_id UUID,
 PRIMARY KEY(owner_id,request_id),
 FOREIGN KEY(owner_id,event_id) REFERENCES vault_events(owner_id,id)
);
ALTER TABLE vault_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON vault_events,event_payments,event_requests FROM anon;
  REVOKE ALL ON SEQUENCE event_payments_position_seq FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON vault_events,event_payments,event_requests FROM authenticated;
  REVOKE ALL ON SEQUENCE event_payments_position_seq FROM authenticated;
 END IF;
END $$;
