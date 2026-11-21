import { randomUUID } from "node:crypto";
import { ApiError, type Identity } from "./domain.js";
import type {
  PersonInput,
  SavedPerson,
  Vault,
  VaultDetail,
  VaultHistory,
  VaultInput,
} from "./directory.js";
import type { SqlClient, SqlPool } from "./store.js";
import { uuidInput } from "./validation.js";
import { personInput, vaultInput } from "./directory.js";
export interface DirectoryStore {
  listPeople(user: Identity): Promise<SavedPerson[]>;
  createPerson(user: Identity, input: PersonInput): Promise<SavedPerson>;
  listVaults(user: Identity): Promise<Vault[]>;
  createVault(user: Identity, input: VaultInput): Promise<VaultDetail>;
  vault(user: Identity, id: string): Promise<VaultDetail>;
  member(
    user: Identity,
    id: string,
    personId: string,
    add: boolean,
  ): Promise<VaultDetail>;
}
const notFound = () =>
  new ApiError(404, "NOT_FOUND", "Vault or person not found.");
const maximum = () =>
  new ApiError(400, "MEMBER_LIMIT", "A vault supports at most 100 members.");
export class MemoryDirectory implements DirectoryStore {
  private people = new Map<string, { ownerId: string; person: SavedPerson }>();
  private vaults = new Map<string, { ownerId: string; detail: VaultDetail }>();
  async listPeople(user: Identity) {
    return structuredClone(
      [...this.people.values()]
        .filter((p) => p.ownerId === user.id)
        .map((p) => p.person),
    );
  }
  async createPerson(user: Identity, input: PersonInput) {
    input = personInput.parse(input);
    const person: SavedPerson = {
      id: randomUUID(),
      name: input.name,
      source: input.source,
      email: input.email ?? null,
      phone: input.phone ?? null,
      createdAt: new Date().toISOString(),
    };
    this.people.set(person.id, { ownerId: user.id, person });
    return structuredClone(person);
  }
  private person(user: Identity, id: string) {
    const found = this.people.get(id);
    if (!found || found.ownerId !== user.id) throw notFound();
    return found.person;
  }
  private owned(user: Identity, id: string) {
    const found = this.vaults.get(id);
    if (!found || found.ownerId !== user.id) throw notFound();
    return found.detail;
  }
  async listVaults(user: Identity) {
    return structuredClone(
      [...this.vaults.values()]
        .filter((v) => v.ownerId === user.id)
        .map((v) => v.detail.vault),
    );
  }
  private event(
    user: Identity,
    action: VaultHistory["action"],
    personId: string | null,
  ): VaultHistory {
    return {
      id: randomUUID(),
      action,
      personId,
      actorId: user.id,
      createdAt: new Date().toISOString(),
    };
  }
  async createVault(user: Identity, input: VaultInput) {
    input = vaultInput.parse(input);
    const members = input.memberIds.map((id) => this.person(user, id));
    const now = new Date().toISOString();
    const detail: VaultDetail = {
      vault: {
        id: randomUUID(),
        title: input.title,
        kind: input.kind,
        archived: false,
        memberIds: [...input.memberIds],
        createdAt: now,
        updatedAt: now,
      },
      members,
      history: [
        this.event(user, "created", null),
        ...members.map((p) => this.event(user, "member_added", p.id)),
      ],
    };
    this.vaults.set(detail.vault.id, { ownerId: user.id, detail });
    return structuredClone(detail);
  }
  async vault(user: Identity, id: string) {
    id = uuidInput.parse(id);
    return structuredClone(this.owned(user, id));
  }
  async member(user: Identity, id: string, personId: string, add: boolean) {
    id = uuidInput.parse(id);
    personId = uuidInput.parse(personId);
    const detail = this.owned(user, id);
    const person = this.person(user, personId);
    const exists = detail.vault.memberIds.includes(personId);
    if (add === exists) return structuredClone(detail);
    if (add && detail.members.length >= 100) throw maximum();
    detail.vault.memberIds = add
      ? [...detail.vault.memberIds, personId]
      : detail.vault.memberIds.filter((id) => id !== personId);
    detail.members = add
      ? [...detail.members, person]
      : detail.members.filter((p) => p.id !== personId);
    const event = this.event(
      user,
      add ? "member_added" : "member_removed",
      personId,
    );
    detail.vault.updatedAt = event.createdAt;
    detail.history.push(event);
    return structuredClone(detail);
  }
}
const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const personColumns = `id,name,source,email,phone,${stamp("created_at")} AS "createdAt"`;
const vaultColumns = `v.id,v.title,v.kind,v.archived,${stamp("v.created_at")} AS "createdAt",${stamp("v.updated_at")} AS "updatedAt",ARRAY(SELECT person_id::text FROM vault_members WHERE vault_id=v.id ORDER BY position) AS "memberIds"`;
export class PostgresDirectory implements DirectoryStore {
  constructor(private pool: SqlPool) {}
  async listPeople(user: Identity) {
    return (
      await this.pool.query<SavedPerson>(
        `SELECT ${personColumns} FROM saved_people WHERE owner_id=$1 ORDER BY created_at,id`,
        [user.id],
      )
    ).rows;
  }
  async createPerson(user: Identity, input: PersonInput) {
    input = personInput.parse(input);
    return (
      await this.pool.query<SavedPerson>(
        `INSERT INTO saved_people(id,owner_id,name,source,email,phone) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${personColumns}`,
        [
          randomUUID(),
          user.id,
          input.name,
          input.source,
          input.email ?? null,
          input.phone ?? null,
        ],
      )
    ).rows[0];
  }
  async listVaults(user: Identity) {
    return (
      await this.pool.query<Vault>(
        `SELECT ${vaultColumns} FROM vaults v WHERE owner_id=$1 ORDER BY created_at,id`,
        [user.id],
      )
    ).rows;
  }
  private async detail(
    client: Pick<SqlClient, "query">,
    user: Identity,
    id: string,
  ): Promise<VaultDetail> {
    const vault = (
      await client.query<Vault>(
        `SELECT ${vaultColumns} FROM vaults v WHERE v.owner_id=$1 AND v.id=$2`,
        [user.id, id],
      )
    ).rows[0];
    if (!vault) throw notFound();
    const people = (
      await client.query<SavedPerson>(
        `SELECT ${personColumns} FROM saved_people WHERE owner_id=$1 AND id=ANY($2::uuid[])`,
        [user.id, vault.memberIds],
      )
    ).rows;
    const members = vault.memberIds.map((id) =>
      people.find((p) => p.id === id)!,
    );
    const history = (
      await client.query<VaultHistory>(
        `SELECT id,action,person_id AS "personId",owner_id AS "actorId",${stamp("created_at")} AS "createdAt" FROM vault_history WHERE owner_id=$1 AND vault_id=$2 ORDER BY position`,
        [user.id, id],
      )
    ).rows;
    return { vault, members, history };
  }
  async vault(user: Identity, id: string) {
    id = uuidInput.parse(id);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await this.detail(client, user, id);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  private async transaction<T>(fn: (client: SqlClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  private async person(client: SqlClient, user: Identity, id: string) {
    if (
      !(
        await client.query(
          "SELECT id FROM saved_people WHERE owner_id=$1 AND id=$2",
          [user.id, id],
        )
      ).rows.length
    )
      throw notFound();
  }
  private async history(
    client: SqlClient,
    user: Identity,
    id: string,
    action: VaultHistory["action"],
    personId: string | null,
  ) {
    await client.query(
      "INSERT INTO vault_history(id,vault_id,owner_id,action,person_id) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), id, user.id, action, personId],
    );
  }
  async createVault(user: Identity, input: VaultInput) {
    input = vaultInput.parse(input);
    return this.transaction(async (client) => {
      const id = randomUUID();
      await client.query(
        "INSERT INTO vaults(id,owner_id,title,kind) VALUES($1,$2,$3,$4)",
        [id, user.id, input.title, input.kind],
      );
      await this.history(client, user, id, "created", null);
      for (const personId of input.memberIds) {
        await this.person(client, user, personId);
        await client.query(
          "INSERT INTO vault_members(vault_id,owner_id,person_id) VALUES($1,$2,$3)",
          [id, user.id, personId],
        );
        await this.history(client, user, id, "member_added", personId);
      }
      return this.detail(client, user, id);
    });
  }
  async member(user: Identity, id: string, personId: string, add: boolean) {
    id = uuidInput.parse(id);
    personId = uuidInput.parse(personId);
    return this.transaction(async (client) => {
      if (
        !(
          await client.query(
            "SELECT id FROM vaults WHERE owner_id=$1 AND id=$2 FOR UPDATE",
            [user.id, id],
          )
        ).rows.length
      )
        throw notFound();
      await this.person(client, user, personId);
      const current = (
        await client.query(
          "SELECT person_id FROM vault_members WHERE owner_id=$1 AND vault_id=$2",
          [user.id, id],
        )
      ).rows;
      const exists = current.some((row) => row.person_id === personId);
      if (add !== exists) {
        if (add && current.length >= 100) throw maximum();
        if (add)
          await client.query(
            "INSERT INTO vault_members(vault_id,owner_id,person_id) VALUES($1,$2,$3)",
            [id, user.id, personId],
          );
        else
          await client.query(
            "DELETE FROM vault_members WHERE owner_id=$1 AND vault_id=$2 AND person_id=$3",
            [user.id, id, personId],
          );
        await this.history(
          client,
          user,
          id,
          add ? "member_added" : "member_removed",
          personId,
        );
        await client.query(
          "UPDATE vaults SET updated_at=clock_timestamp() WHERE owner_id=$1 AND id=$2",
          [user.id, id],
        );
      }
      return this.detail(client, user, id);
    });
  }
}
