/**
 * `MetaStore` on SQLite through the Tauri plugin.
 *
 * Same contract as the browser implementation, same schema versions, same
 * crash-safety rule: one transaction per write, additive migrations only (see
 * docs/DATA-MODEL.md). Nothing here stores file content.
 */
import Database from '@tauri-apps/plugin-sql';
import { DropForgeError, ERROR_CODES, type MetaStore, type StoredRecord } from '@dropforge/app-core';

/** Version of the local schema; additive migrations only. */
const SCHEMA_VERSION = 2;

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS records (
     collection TEXT NOT NULL,
     key        TEXT NOT NULL,
     value      TEXT NOT NULL,
     PRIMARY KEY (collection, key)
   )`,
  `CREATE TABLE IF NOT EXISTS meta (
     name  TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
];

export class SqliteMetaStore implements MetaStore {
  readonly kind = 'sqlite' as const;
  schemaVersion = 0;
  private db: Database | undefined;

  constructor(private readonly url: string, private readonly options: { logger?: { log: (level: 'warn', message: string, fields?: Record<string, unknown>) => void } } = {}) {}

  async init(): Promise<void> {
    try {
      this.db = await Database.load(this.url);
      for (const statement of CREATE_TABLES) await this.db.execute(statement);
      this.schemaVersion = await this.readSchemaVersion();
    } catch (error) {
      throw new DropForgeError(ERROR_CODES.STORAGE_UNAVAILABLE, 'The local database could not be opened', {
        cause: error,
      });
    }
  }

  async get<T>(collection: string, key: string): Promise<T | undefined> {
    const rows = await this.query<{ value: string }>('SELECT value FROM records WHERE collection = $1 AND key = $2', [
      collection,
      key,
    ]);
    const row = rows[0];
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  async put<T>(collection: string, key: string, value: T): Promise<void> {
    await this.transaction([{ statement: INSERT, params: [collection, key, JSON.stringify(value)] }]);
  }

  async putMany<T>(collection: string, records: StoredRecord<T>[]): Promise<void> {
    // One transaction: either every record is written or none is, so a crash can
    // never leave a half-applied batch visible.
    await this.transaction(
      records.map((record) => ({ statement: INSERT, params: [collection, record.key, JSON.stringify(record.value)] })),
    );
  }

  async list<T>(collection: string, options: { prefix?: string; limit?: number } = {}): Promise<Array<StoredRecord<T>>> {
    const rows = await this.query<{ key: string; value: string }>(
      'SELECT key, value FROM records WHERE collection = $1 AND key LIKE $2 ORDER BY key LIMIT $3',
      [collection, `${options.prefix ?? ''}%`, options.limit ?? 10_000],
    );
    return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) as T }));
  }

  async delete(collection: string, key: string): Promise<void> {
    await this.run('DELETE FROM records WHERE collection = $1 AND key = $2', [collection, key]);
  }

  async deleteCollection(collection: string): Promise<void> {
    await this.run('DELETE FROM records WHERE collection = $1', [collection]);
  }

  async close(): Promise<void> {
    await this.db?.close();
    this.db = undefined;
  }

  private async readSchemaVersion(): Promise<number> {
    const rows = await this.query<{ value: string }>('SELECT value FROM meta WHERE name = $1', ['schema_version']);
    const current = rows[0] ? Number(rows[0].value) : 0;
    if (current === SCHEMA_VERSION) return current;
    if (current > SCHEMA_VERSION) {
      // A database written by a *newer* DropForge: opening it read-only would be
      // safer, but silently rewriting it would be worse. Refuse and explain.
      throw new DropForgeError(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        'The local database was written by a newer version of DropForge',
        { context: { found: current, expected: SCHEMA_VERSION } },
      );
    }
    // Additive migration: the tables above are created idempotently, so the only
    // thing to do is record the new version.
    await this.run(INSERT_META, [String(SCHEMA_VERSION)]);
    return SCHEMA_VERSION;
  }

  private async transaction(operations: Array<{ statement: string; params: unknown[] }>): Promise<void> {
    const db = this.database();
    await db.execute('BEGIN');
    try {
      for (const operation of operations) await db.execute(operation.statement, operation.params);
      await db.execute('COMMIT');
    } catch (error) {
      await db.execute('ROLLBACK').catch(() => undefined);
      throw this.fail(error);
    }
  }

  private async run(statement: string, params: unknown[]): Promise<void> {
    await this.database().execute(statement, params);
  }

  private async query<T>(statement: string, params: unknown[]): Promise<T[]> {
    return (await this.database().select<T[]>(statement, params)) as T[];
  }

  private database(): Database {
    if (!this.db) throw new DropForgeError(ERROR_CODES.STORAGE_UNAVAILABLE, 'The local database is not open');
    return this.db;
  }

  private fail(cause: unknown): DropForgeError {
    return cause instanceof DropForgeError
      ? cause
      : new DropForgeError(ERROR_CODES.WRITE_FAILED, 'The local database rejected the operation', { cause });
  }
}

const INSERT = `INSERT INTO records (collection, key, value) VALUES ($1, $2, $3)
                ON CONFLICT (collection, key) DO UPDATE SET value = excluded.value`;
const INSERT_META = `INSERT INTO meta (name, value) VALUES ('schema_version', $1)
                     ON CONFLICT (name) DO UPDATE SET value = excluded.value`;
