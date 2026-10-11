/**
 * Supabase falso en memoria para tests de componentes.
 *
 * Imita el subconjunto del cliente que usan los componentes (auth.getUser,
 * from().select/insert/update + filtros, storage.from().upload) y registra cada
 * llamada para poder afirmar sobre lo que el componente envió. No habla con la
 * red. Las consultas select filtran las filas del fixture por los `eq`
 * aplicados, suficiente para los listados de la app.
 */
import { vi } from "vitest";

export interface RecordedCall {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: [string, unknown][];
}

export interface UploadCall {
  bucket: string;
  path: string;
  file: unknown;
  options?: unknown;
}

export interface FakeSupabaseOptions {
  user?: { id: string } | null;
  tables?: Record<string, Record<string, unknown>[]>;
  /** Error a devolver en el próximo insert sobre esa tabla. */
  insertErrors?: Record<string, { message: string }>;
  updateErrors?: Record<string, { message: string }>;
  uploadError?: { message: string } | null;
}

type Result = { data: unknown; error: { message: string } | null };

class QueryBuilder implements PromiseLike<Result> {
  private op: RecordedCall["op"] = "select";
  private payload: unknown;
  private filters: [string, unknown][] = [];
  private wantSingle = false;
  private wantRows = false;

  constructor(private readonly table: string, private readonly fake: FakeSupabase) {}

  select() {
    if (this.op === "select") this.wantRows = true;
    return this;
  }
  insert(payload: unknown) { this.op = "insert"; this.payload = payload; return this; }
  update(payload: unknown) { this.op = "update"; this.payload = payload; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, val: unknown) { this.filters.push([col, val]); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.wantSingle = true; return this; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  single(): any { this.wantSingle = true; return this; }

  private execute(): Result {
    this.fake.calls.push({ table: this.table, op: this.op, payload: this.payload, filters: this.filters });
    if (this.op === "insert") {
      const err = this.fake.options.insertErrors?.[this.table] ?? null;
      if (err) return { data: null, error: err };
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const withIds = rows.map((r, i) => ({ id: `${this.table}-new-${this.fake.calls.length}-${i}`, ...(r as object) }));
      return { data: this.wantSingle ? withIds[0] : withIds, error: null };
    }
    if (this.op === "update" || this.op === "delete") {
      const err = this.fake.options.updateErrors?.[this.table] ?? null;
      return { data: null, error: err };
    }
    const rows = (this.fake.options.tables?.[this.table] ?? []).filter((row) =>
      this.filters.every(([col, val]) => row[col] === val),
    );
    if (this.wantSingle) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

export class FakeSupabase {
  calls: RecordedCall[] = [];
  uploads: UploadCall[] = [];

  constructor(public options: FakeSupabaseOptions = {}) {}

  auth = {
    getUser: vi.fn(async () => ({
      data: { user: this.options.user === undefined ? { id: "user-1" } : this.options.user },
      error: null,
    })),
  };

  from(table: string) {
    return new QueryBuilder(table, this);
  }

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, file: unknown, options?: unknown) => {
        this.uploads.push({ bucket, path, file, options });
        const error = this.options.uploadError ?? null;
        return { data: error ? null : { path }, error };
      },
    }),
  };

  callsTo(table: string, op?: RecordedCall["op"]) {
    return this.calls.filter((c) => c.table === table && (!op || c.op === op));
  }
}
