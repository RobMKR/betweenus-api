import pg from "pg";
import { transition, visible, type Debt, type Identity } from "./domain.js";
export interface Store {
  listFor(user: Identity): Promise<Debt[]>;
  create(debt: Debt): Promise<Debt>;
  respond(
    id: string,
    user: Identity,
    action: "accepted" | "disputed",
    reason?: string,
  ): Promise<Debt>;
  close(): Promise<void>;
}
export class MemoryStore implements Store {
  private debts: Debt[] = [];
  async listFor(user: Identity) {
    return structuredClone(this.debts.filter((d) => visible(d, user)));
  }
  async create(debt: Debt) {
    this.debts.push(structuredClone(debt));
    return structuredClone(debt);
  }
  async respond(
    id: string,
    user: Identity,
    action: "accepted" | "disputed",
    reason?: string,
  ) {
    const index = this.debts.findIndex((d) => d.id === id);
    const debt = transition(this.debts[index], user, action, reason);
    this.debts[index] = debt;
    return structuredClone(debt);
  }
  async close() {}
}
const projection = `id, lender_id AS "lenderId", lender_email AS "lenderEmail", borrower_email AS "borrowerEmail", borrower_id AS "borrowerId", status, amount_minor AS "amountMinor", currency, description, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt", to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt", history`;
const authorized = `(lender_id=$1 OR borrower_id=$1 OR (borrower_id IS NULL AND borrower_email=$2))`;
export interface SqlClient {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  release(): void;
}
export interface SqlPool {
  query: SqlClient["query"];
  connect(): Promise<SqlClient>;
  end(): Promise<void>;
}
export class PostgresStore implements Store {
  private pool: SqlPool;
  constructor(url: string | SqlPool) {
    this.pool =
      typeof url === "string"
        ? new pg.Pool({ connectionString: url, max: 5 })
        : url;
  }
  async listFor(user: Identity) {
    const { rows } = await this.pool.query<Debt>(
      `SELECT ${projection} FROM debts WHERE ${authorized} ORDER BY created_at DESC`,
      [user.id, user.email],
    );
    return rows;
  }
  async create(debt: Debt) {
    await this.pool.query(
      `INSERT INTO debts(id,lender_id,lender_email,borrower_email,borrower_id,status,amount_minor,currency,description,created_at,updated_at,history) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        debt.id,
        debt.lenderId,
        debt.lenderEmail,
        debt.borrowerEmail,
        debt.borrowerId,
        debt.status,
        debt.amountMinor,
        debt.currency,
        debt.description,
        debt.createdAt,
        debt.updatedAt,
        JSON.stringify(debt.history),
      ],
    );
    return debt;
  }
  async respond(
    id: string,
    user: Identity,
    action: "accepted" | "disputed",
    reason?: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<Debt>(
        `SELECT ${projection} FROM debts WHERE ${authorized} AND id=$3 FOR UPDATE`,
        [user.id, user.email, id],
      );
      const debt = transition(rows[0], user, action, reason);
      await client.query(
        "UPDATE debts SET borrower_id=$2,status=$3,updated_at=$4,history=$5 WHERE id=$1",
        [
          id,
          debt.borrowerId,
          debt.status,
          debt.updatedAt,
          JSON.stringify(debt.history),
        ],
      );
      await client.query("COMMIT");
      return debt;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
