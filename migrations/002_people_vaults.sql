-- Private owner records. Contact provenance never grants verified identity or access.
CREATE TABLE saved_people (
 id UUID PRIMARY KEY,
 owner_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
 source TEXT NOT NULL CHECK (source IN ('custom','contact')),
 email TEXT CHECK (length(email)<=254 AND email=lower(email)),
 phone TEXT CHECK (length(phone)<=40 AND phone ~ '^[+0-9() .-]+$' AND phone ~ '[0-9]'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,id)
);
CREATE INDEX saved_people_owner_idx ON saved_people(owner_id,created_at,id);
CREATE TABLE vaults (
 id UUID PRIMARY KEY,
 owner_id TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 kind TEXT NOT NULL CHECK(kind IN ('temporary','permanent')),
 archived BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,id)
);
CREATE INDEX vaults_owner_idx ON vaults(owner_id,created_at,id);
CREATE TABLE vault_members (
 vault_id UUID NOT NULL,
 owner_id TEXT NOT NULL,
 person_id UUID NOT NULL,
 position BIGINT GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(vault_id,person_id),
 FOREIGN KEY(owner_id,vault_id) REFERENCES vaults(owner_id,id),
 FOREIGN KEY(owner_id,person_id) REFERENCES saved_people(owner_id,id)
);
CREATE INDEX vault_members_owner_idx ON vault_members(owner_id,vault_id,position);
CREATE TABLE vault_history (
 id UUID PRIMARY KEY,
 vault_id UUID NOT NULL,
 owner_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('created','member_added','member_removed')),
 person_id UUID,
 position BIGINT GENERATED ALWAYS AS IDENTITY,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(owner_id,vault_id) REFERENCES vaults(owner_id,id),
 FOREIGN KEY(owner_id,person_id) REFERENCES saved_people(owner_id,id),
 CHECK((action='created' AND person_id IS NULL) OR (action<>'created' AND person_id IS NOT NULL))
);
CREATE INDEX vault_history_owner_idx ON vault_history(owner_id,vault_id,position);
ALTER TABLE saved_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON saved_people,vaults,vault_members,vault_history FROM anon;
  REVOKE ALL ON SEQUENCE vault_members_position_seq,vault_history_position_seq FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON saved_people,vaults,vault_members,vault_history FROM authenticated;
  REVOKE ALL ON SEQUENCE vault_members_position_seq,vault_history_position_seq FROM authenticated;
 END IF;
END $$;
