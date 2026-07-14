declare module 'sql.js' {
  interface SqlJsStatic {
    Database: typeof Database
  }

  interface SqlJsConfig {
    locateFile?: (filename: string) => string
  }

  interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  interface Statement {
    bind(): boolean
    bind(params: unknown[]): boolean
    step(): boolean
    getAsObject(params?: unknown[]): Record<string, unknown>
    get(params?: unknown[]): unknown[]
    run(params?: unknown[]): void
    free(): boolean
    reset(): void
  }

  class Database {
    constructor()
    constructor(data?: ArrayLike<number>)
    constructor(data?: ArrayBuffer)
    run(sql: string, params?: unknown[]): Database
    exec(sql: string, params?: unknown[]): QueryExecResult[]
    prepare(sql: string): Statement
    export(): Uint8Array
    close(): void
    getRowsModified(): number
  }

  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>
  export default initSqlJs
  export { Database, Statement, QueryExecResult, SqlJsStatic, SqlJsConfig }
}
