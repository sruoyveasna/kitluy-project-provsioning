/**
 * The terminal-local relational driver port — WS-11-T004-P04C2.
 *
 * ===========================================================================
 * WHY A PORT AND NOT A DIRECT node:sqlite DEPENDENCY
 * ===========================================================================
 * The P04C package requires "a shared interface that can later support React
 * Native", and explicitly forbids a speculative mobile implementation while the
 * repository lacks the runtime authority for one. This interface is that
 * seam, and it is deliberately tiny: `exec`, `run`, `all`, `transaction`,
 * `close`. Every SQLite-compatible driver a future runtime might carry
 * (`expo-sqlite`, `op-sqlite`, `better-sqlite3`) can satisfy it in a few dozen
 * lines, and nothing above it knows which one is underneath.
 *
 * ONLY the Electron T1-T4 implementation ships today (Phase 1's implemented
 * runtime), built on Node 22's BUILT-IN `node:sqlite`. That choice avoids a
 * native build in a repository that does not build native modules
 * (`pnpm.neverBuiltDependencies`), at the cost of an API Node still marks
 * experimental — RECORDED here rather than hidden: if `node:sqlite` changes,
 * this file changes and nothing else does, which is the point of the port.
 */

export type SqlValue = string | number | bigint | null;

export interface TerminalSqlDriver {
  /** DDL and pragmas. No parameters, by design. */
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  all<T extends Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): T[];
  /**
   * Runs `body` in ONE transaction. A throw rolls everything back — the
   * receipt row and the current-receipt pointer must move together or not at
   * all, which is the invariant this method exists to make un-forgettable.
   */
  transaction<T>(body: () => T): T;
  close(): void;
}

/** The subset of `node:sqlite`'s DatabaseSync this driver uses. */
interface SqliteStatement {
  run(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

/**
 * The Electron T1-T4 driver.
 *
 * `database` is injected rather than constructed so this module imports
 * nothing runtime-specific: the Electron main process passes
 * `new DatabaseSync(path)` from `node:sqlite`, and a test passes one over
 * `:memory:`. Nested `transaction` calls join the outer transaction rather
 * than opening a second one, because SQLite has no nested transactions and
 * silently committing the inner one would break the atomicity the callers
 * depend on.
 */
export function createSqliteDriver(database: SqliteDatabase): TerminalSqlDriver {
  let depth = 0;
  return {
    exec: (sql) => database.exec(sql),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params);
    },
    all: <T extends Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): T[] =>
      database.prepare(sql).all(...params) as T[],
    transaction<T>(body: () => T): T {
      if (depth > 0) return body();
      database.exec("begin immediate");
      depth += 1;
      try {
        const result = body();
        database.exec("commit");
        return result;
      } catch (error) {
        database.exec("rollback");
        throw error;
      } finally {
        depth -= 1;
      }
    },
    close: () => database.close(),
  };
}
