declare module 'sqlite3' {
  export const OPEN_READONLY: number;
  export const OPEN_READWRITE: number;
  export const OPEN_CREATE: number;

  export class Database {
    constructor(filename: string, mode?: number, callback?: (err: Error | null) => void);
    get(sql: string, params: unknown[], callback?: (err: Error | null, row: Record<string, unknown> | undefined) => void): this;
    all(sql: string, params: unknown[], callback?: (err: Error | null, rows: Record<string, unknown>[]) => void): this;
    close(callback?: (err: Error | null) => void): void;
  }
}
