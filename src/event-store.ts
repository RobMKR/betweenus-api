import { createHash } from "node:crypto";
import { ApiError, type Identity } from "./domain.js";
import { uuidInput } from "./validation.js";
import type { MemoryDirectory, PostgresDirectory } from "./directory-store.js";
import { currencyInput, type Currency } from "./currency.js";
import type { Vault, VaultDetail } from "./directory.js";
import type { SqlClient, SqlPool } from "./store.js";
import {
  eventInput,
  paymentInput,
  undoInput,
  makeEvent,
  viewEvent,
  privateBalances,
  summarize,
  recordPayment,
  reversePayment,
  requireActive,
  requireVaultCurrency,
  missingEvent,
  type EventInput,
  type PaymentInput,
  type UndoInput,
  type StoredEvent,
  type AccountEvent,
  type EventPayment,
  type VaultSummary,
  type VaultSummaryDetail,
  type PrivateBalance,
} from "./events.js";
export interface EventStore {
  create(
    user: Identity,
    vaultId: string,
    input: EventInput,
  ): Promise<AccountEvent>;
  list(user: Identity, vaultId?: string): Promise<AccountEvent[]>;
  get(user: Identity, id: string): Promise<AccountEvent>;
  pay(user: Identity, id: string, input: PaymentInput): Promise<AccountEvent>;
  undo(
    user: Identity,
    id: string,
    paymentId: string,
    input: UndoInput,
  ): Promise<AccountEvent>;
  archive(
    user: Identity,
    id: string,
    archived: boolean,
  ): Promise<VaultSummaryDetail>;
  changeCurrency(
    user: Identity,
    id: string,
    currency: Currency,
  ): Promise<VaultSummaryDetail>;
  vaults(user: Identity, vaults: Vault[]): Promise<VaultSummary[]>;
  detail(user: Identity, detail: VaultDetail): Promise<VaultSummaryDetail>;
  balances(user: Identity): Promise<PrivateBalance[]>;
}
const conflict = () =>
  new ApiError(
    409,
    "IDEMPOTENCY_CONFLICT",
    "Request ID was already used for different operation data.",
  );
const fingerprint = (action: string, resource: string, input: unknown) =>
  createHash("sha256")
    .update(JSON.stringify({ action, resource, input }))
    .digest("hex");
abstract class Summaries {
  abstract list(user: Identity, vaultId?: string): Promise<AccountEvent[]>;
  async vaults(user: Identity, vaults: Vault[]) {
    const events = await this.list(user);
    return vaults.map((vault) => summarize(vault, events));
  }
  async detail(
    user: Identity,
    detail: VaultDetail,
  ): Promise<VaultSummaryDetail> {
    return {
      ...detail,
      vault: summarize(detail.vault, await this.list(user, detail.vault.id)),
    };
  }
  async balances(user: Identity) {
    return privateBalances(await this.list(user));
  }
}
export class MemoryEvents extends Summaries implements EventStore {
  private events = new Map<string, { ownerId: string; event: StoredEvent }>();
  private requests = new Map<string, { hash: string; eventId: string }>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private directory: MemoryDirectory) {
    super();
  }
  private serial<T>(fn: () => Promise<T>) {
    const result = this.queue.then(fn);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private owned(user: Identity, id: string) {
    const row = this.events.get(id);
    if (!row || row.ownerId !== user.id) throw missingEvent();
    return row.event;
  }
  async list(user: Identity, vaultId?: string) {
    if (vaultId !== undefined) vaultId = uuidInput.parse(vaultId);
    if (vaultId) await this.directory.vault(user, vaultId);
    return [...this.events.values()]
      .filter(
        (row) =>
          row.ownerId === user.id &&
          (!vaultId || row.event.vaultId === vaultId),
      )
      .map((row) => viewEvent(row.event));
  }
  async get(user: Identity, id: string) {
    id = uuidInput.parse(id);
    return viewEvent(this.owned(user, id));
  }
  private write(
    user: Identity,
    key: string,
    hash: string,
    operation: () => Promise<StoredEvent>,
  ) {
    return this.serial(async () => {
      const requestKey = `${user.id}:${key}`;
      const prior = this.requests.get(requestKey);
      if (prior) {
        if (prior.hash !== hash) throw conflict();
        return viewEvent(this.owned(user, prior.eventId));
      }
      const event = await operation();
      this.events.set(event.id, { ownerId: user.id, event });
      this.requests.set(requestKey, { hash, eventId: event.id });
      return viewEvent(event);
    });
  }
  async create(user: Identity, vaultId: string, raw: EventInput) {
    vaultId = uuidInput.parse(vaultId);
    const input = eventInput.parse(raw);
    return this.write(
      user,
      input.clientRequestId,
      fingerprint("create", vaultId, input),
      async () => {
        const detail = await this.directory.vault(user, vaultId);
        requireActive(detail.vault.archived);
        requireVaultCurrency(detail.vault.currency, input.currency);
        return makeEvent(vaultId, input, await this.directory.listPeople(user));
      },
    );
  }
  async pay(user: Identity, id: string, raw: PaymentInput) {
    id = uuidInput.parse(id);
    const input = paymentInput.parse(raw);
    return this.write(
      user,
      input.clientRequestId,
      fingerprint("pay", id, input),
      async () => {
        const event = this.owned(user, id);
        requireActive(
          (await this.directory.vault(user, event.vaultId)).vault.archived,
        );
        return recordPayment(event, input);
      },
    );
  }
  async undo(user: Identity, id: string, paymentId: string, raw: UndoInput) {
    id = uuidInput.parse(id);
    paymentId = uuidInput.parse(paymentId);
    const input = undoInput.parse(raw);
    return this.write(
      user,
      input.clientRequestId,
      fingerprint("undo", `${id}/${paymentId}`, input),
      async () => {
        const event = this.owned(user, id);
        requireActive(
          (await this.directory.vault(user, event.vaultId)).vault.archived,
        );
        return reversePayment(event, paymentId);
      },
    );
  }
  async changeCurrency(user: Identity, id: string, raw: Currency) {
    id = uuidInput.parse(id);
    const currency = currencyInput.parse(raw);
    return this.serial(async () => {
      const events = await this.list(user, id);
      const detail = this.directory.changeCurrency(
        user,
        id,
        currency,
        events.length > 0,
      );
      return { ...detail, vault: summarize(detail.vault, events) };
    });
  }
  async archive(user: Identity, id: string, archived: boolean) {
    id = uuidInput.parse(id);
    return this.serial(async () =>
      this.detail(user, await this.directory.archive(user, id, archived)),
    );
  }
}
const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const eventColumns = `id,vault_id AS "vaultId",title,to_char(event_date,'YYYY-MM-DD') AS date,currency,total_minor AS "totalMinor",payer_id AS "payerId",split_mode AS "splitMode",partial_payments AS "partialPayments",participants,${stamp("created_at")} AS "createdAt",${stamp("updated_at")} AS "updatedAt"`;
const paymentColumns = `id,event_id AS "eventId",participant_id AS "participantId",amount_minor AS "amountMinor",reverses_id AS "reversesId",${stamp("created_at")} AS "createdAt"`;
export class PostgresEvents extends Summaries implements EventStore {
  constructor(
    private pool: SqlPool,
    private directory: PostgresDirectory,
  ) {
    super();
  }
  private async transaction<T>(
    fn: (client: SqlClient) => Promise<T>,
    read = false,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query(
        read ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
      );
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
  private async vault(
    client: SqlClient,
    user: Identity,
    id: string,
    lock = false,
  ) {
    const row = (
      await client.query<{ archived: boolean; currency: Currency }>(
        `SELECT archived,currency FROM vaults WHERE owner_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
        [user.id, id],
      )
    ).rows[0];
    if (!row) throw missingEvent();
    return row;
  }
  private async events(
    client: SqlClient,
    user: Identity,
    filter?: { vaultId?: string; id?: string },
  ): Promise<StoredEvent[]> {
    const rows = (
      await client.query<Omit<StoredEvent, "payments">>(
        `SELECT ${eventColumns} FROM vault_events WHERE owner_id=$1${filter?.vaultId ? " AND vault_id=$2" : filter?.id ? " AND id=$2" : ""} ORDER BY created_at,id`,
        [
          user.id,
          ...(filter?.vaultId
            ? [filter.vaultId]
            : filter?.id
              ? [filter.id]
              : []),
        ],
      )
    ).rows;
    if (!rows.length) return [];
    const payments = (
      await client.query<
        EventPayment & { eventId: string; reversesId: string | null }
      >(
        `SELECT ${paymentColumns} FROM event_payments WHERE owner_id=$1 AND event_id=ANY($2::uuid[]) ORDER BY position`,
        [user.id, rows.map((event) => event.id)],
      )
    ).rows;
    return rows.map((row) => ({
      ...row,
      payments: payments
        .filter((payment) => payment.eventId === row.id)
        .map((payment) => ({
          id: payment.id,
          participantId: payment.participantId,
          amountMinor: payment.amountMinor,
          createdAt: payment.createdAt,
          ...(payment.reversesId ? { reversesId: payment.reversesId } : {}),
        })),
    }));
  }
  async list(user: Identity, vaultId?: string) {
    if (vaultId !== undefined) vaultId = uuidInput.parse(vaultId);
    return this.transaction(async (client) => {
      if (vaultId) await this.vault(client, user, vaultId);
      return (await this.events(client, user, { vaultId })).map(viewEvent);
    }, true);
  }
  async get(user: Identity, id: string) {
    id = uuidInput.parse(id);
    return this.transaction(async (client) => {
      const event = (await this.events(client, user, { id }))[0];
      if (!event) throw missingEvent();
      return viewEvent(event);
    }, true);
  }
  private async lockedEvent(client: SqlClient, user: Identity, id: string) {
    const reference = (
      await client.query<{ vaultId: string }>(
        'SELECT vault_id AS "vaultId" FROM vault_events WHERE owner_id=$1 AND id=$2',
        [user.id, id],
      )
    ).rows[0];
    if (!reference) throw missingEvent();
    const vault = await this.vault(client, user, reference.vaultId, true);
    await client.query(
      "SELECT id FROM vault_events WHERE owner_id=$1 AND id=$2 FOR UPDATE",
      [user.id, id],
    );
    const event = (await this.events(client, user, { id }))[0];
    if (!event) throw missingEvent();
    return { event, vault };
  }
  private write(
    user: Identity,
    key: string,
    hash: string,
    action: string,
    resource: string,
    operation: (client: SqlClient) => Promise<StoredEvent>,
  ) {
    return this.transaction(async (client) => {
      const inserted = await client.query(
        "INSERT INTO event_requests(owner_id,request_id,fingerprint,action,resource) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,request_id) DO NOTHING RETURNING request_id",
        [user.id, key, hash, action, resource],
      );
      if (!inserted.rows.length) {
        const prior = (
          await client.query<{ fingerprint: string; eventId: string }>(
            'SELECT fingerprint,event_id AS "eventId" FROM event_requests WHERE owner_id=$1 AND request_id=$2 FOR UPDATE',
            [user.id, key],
          )
        ).rows[0];
        if (!prior || prior.fingerprint !== hash) throw conflict();
        return viewEvent(
          (await this.lockedEvent(client, user, prior.eventId)).event,
        );
      }
      const event = await operation(client);
      await client.query(
        "UPDATE event_requests SET event_id=$3 WHERE owner_id=$1 AND request_id=$2",
        [user.id, key, event.id],
      );
      return viewEvent(event);
    });
  }
  async create(user: Identity, vaultId: string, raw: EventInput) {
    vaultId = uuidInput.parse(vaultId);
    const input = eventInput.parse(raw);
    return this.write(
      user,
      input.clientRequestId,
      fingerprint("create", vaultId, input),
      "create",
      vaultId,
      async (client) => {
        const vault = await this.vault(client, user, vaultId, true);
        requireActive(vault.archived);
        requireVaultCurrency(vault.currency, input.currency);
        const ids = input.participantIds.filter((id) => id !== "self");
        const people = (
          await client.query<{ id: string; name: string }>(
            "SELECT id,name FROM saved_people WHERE owner_id=$1 AND id=ANY($2::uuid[])",
            [user.id, ids],
          )
        ).rows;
        const event = makeEvent(vaultId, input, people);
        await client.query(
          "INSERT INTO vault_events(id,owner_id,vault_id,title,event_date,currency,total_minor,payer_id,split_mode,participants,created_at,updated_at,partial_payments) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
          [
            event.id,
            user.id,
            vaultId,
            event.title,
            event.date,
            event.currency,
            event.totalMinor,
            event.payerId,
            event.splitMode,
            JSON.stringify(event.participants),
            event.createdAt,
            event.updatedAt,
            event.partialPayments,
          ],
        );
        return event;
      },
    );
  }
  private async append(client: SqlClient, user: Identity, event: StoredEvent) {
    const payment = event.payments.at(-1)!;
    await client.query(
      "INSERT INTO event_payments(id,owner_id,event_id,participant_id,amount_minor,reverses_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        payment.id,
        user.id,
        event.id,
        payment.participantId,
        payment.amountMinor,
        payment.reversesId ?? null,
        payment.createdAt,
      ],
    );
    await client.query(
      "UPDATE vault_events SET updated_at=$3 WHERE owner_id=$1 AND id=$2",
      [user.id, event.id, event.updatedAt],
    );
  }
  async pay(user: Identity, id: string, raw: PaymentInput) {
    id = uuidInput.parse(id);
    const input = paymentInput.parse(raw);
    return this.write(
      user,
      input.clientRequestId,
      fingerprint("pay", id, input),
      "pay",
      id,
      async (client) => {
        const { event, vault } = await this.lockedEvent(client, user, id);
        requireActive(vault.archived);
        const updated = recordPayment(event, input);
        await this.append(client, user, updated);
        return updated;
      },
    );
  }
  async undo(user: Identity, id: string, paymentId: string, raw: UndoInput) {
    id = uuidInput.parse(id);
    paymentId = uuidInput.parse(paymentId);
    const input = undoInput.parse(raw);
    return this.write(
      user,
      input.clientRequestId,
      fingerprint("undo", `${id}/${paymentId}`, input),
      "undo",
      `${id}/${paymentId}`,
      async (client) => {
        const { event, vault } = await this.lockedEvent(client, user, id);
        requireActive(vault.archived);
        const updated = reversePayment(event, paymentId);
        await this.append(client, user, updated);
        return updated;
      },
    );
  }
  async changeCurrency(user: Identity, id: string, currency: Currency) {
    return this.detail(
      user,
      await this.directory.changeCurrency(user, id, currency),
    );
  }
  async archive(user: Identity, id: string, archived: boolean) {
    id = uuidInput.parse(id);
    return this.detail(user, await this.directory.archive(user, id, archived));
  }
}
