/**
 * Pure helpers underpinning the `pm.*` sandbox API. Extracted from
 * `scriptWorker.ts` so they can be unit-tested in Node (the worker module
 * itself has Worker-only globals at the top level, so `vitest` can't load
 * it directly).
 *
 * No DOM / Tauri / Worker dependencies in here — these are plain functions
 * over plain values.
 */

// ---- Scope wrappers ---------------------------------------------------------

/** A mutable variable scope (env / globals / collection vars / transient). */
export interface ScopeApi {
  get(k: string): string | undefined;
  set(k: string, v: unknown): void;
  unset(k: string): void;
  has(k: string): boolean;
  toObject(): Record<string, string>;
  clear(): void;
}

/** A read-only variable scope (iterationData). Set/unset throw so a typo'd
 *  Postman script doesn't silently lose data. */
export interface ReadOnlyScopeApi {
  get(k: string): string | undefined;
  has(k: string): boolean;
  toObject(): Record<string, string>;
  set(k: string, v: unknown): void;
  unset(k: string): void;
}

/** Build the small CRUD wrapper Postman scripts expect for every scope.
 *  Mutates the target Record<string, string> in place — callers can read
 *  back the post-script state through the same reference they passed in. */
export function scopeApi(target: Record<string, string>): ScopeApi {
  return {
    get: (k) => target[k],
    set: (k, v) => {
      target[k] = String(v);
    },
    unset: (k) => {
      delete target[k];
    },
    has: (k) => k in target,
    toObject: () => ({ ...target }),
    clear: () => {
      for (const k of Object.keys(target)) delete target[k];
    },
  };
}

/** Read-only wrapper for `pm.iterationData`. Write attempts throw with the
 *  scope name in the error so the user can see exactly what's read-only. */
export function readonlyScopeApi(
  target: Record<string, string>,
  name: string,
): ReadOnlyScopeApi {
  return {
    get: (k) => target[k],
    has: (k) => k in target,
    toObject: () => ({ ...target }),
    set: () => {
      throw new Error(`${name} is read-only`);
    },
    unset: () => {
      throw new Error(`${name} is read-only`);
    },
  };
}

// ---- Chai-flavoured assertion chain ----------------------------------------

export interface ChainTo {
  equal: (expected: unknown) => void;
  eql: (expected: unknown) => void;
  include: (expected: unknown) => void;
  match: (re: RegExp) => void;
  have: Record<string, unknown>;
  be: Record<string, unknown>;
  above: (n: number) => void;
  below: (n: number) => void;
  greaterThan: (n: number) => void;
  lessThan: (n: number) => void;
  lengthOf: (n: number) => void;
  deep: { equal: (expected: unknown) => void };
  /** `.to.not` — inverts polarity. */
  not: ChainTo;
}

export interface ChainNode {
  to: ChainTo;
  /** Top-level `.not` so `expect(x).not.to.equal(y)` works alongside the
   *  more common `expect(x).to.not.equal(y)`. */
  not: ChainNode;
}

/**
 * Build a Chai-flavoured assertion chain. `negate` flips the polarity so
 * `expect(x).to.not.equal(y)` works. The chain returns itself everywhere a
 * Chai chain would (e.g. `.to`, `.be`, `.have`, `.deep`) so users can write
 * fluent assertions that mirror what they're used to in Postman / Mocha.
 *
 * Where Chai is famously a property-getter API (`expect(x).to.be.ok` is a
 * getter that throws synchronously), we replicate that semantics for the
 * truthy/falsy/null/undefined/empty cluster — defining them as methods
 * would let `expect(null).to.be.ok` silently pass because the function
 * reference is truthy.
 */
export function buildChain(actual: unknown, negate: boolean): ChainNode {
  const failIfNot = (cond: boolean, msg: string) => {
    if (negate ? cond : !cond) {
      throw new Error((negate ? "expected NOT: " : "") + msg);
    }
  };

  const lengthOf = (n: number) => {
    const len = (actual as { length?: number })?.length;
    failIfNot(len === n, `expected length ${len} to equal ${n}`);
  };

  const equalFn = (expected: unknown) =>
    failIfNot(
      actual === expected,
      `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
    );
  const eqlFn = (expected: unknown) =>
    failIfNot(
      JSON.stringify(actual) === JSON.stringify(expected),
      `expected ${JSON.stringify(actual)} to deeply equal ${JSON.stringify(expected)}`,
    );
  const aboveFn = (n: number) =>
    failIfNot(
      typeof actual === "number" && actual > n,
      `expected ${actual} to be above ${n}`,
    );
  const belowFn = (n: number) =>
    failIfNot(
      typeof actual === "number" && actual < n,
      `expected ${actual} to be below ${n}`,
    );

  const have = {
    status: (code: number) => {
      const r = actual as { status?: number };
      failIfNot(
        r?.status === code,
        `expected status ${code}, got ${r?.status}`,
      );
    },
    property: (key: string) => {
      const hasIt =
        !!actual && typeof actual === "object" && key in (actual as object);
      failIfNot(hasIt, `expected object to have property "${key}"`);
    },
    lengthOf,
    /** `.have.length` is an alias used by some scripts. */
    length: lengthOf,
  };

  const be: Record<string, unknown> = {};
  Object.defineProperty(be, "ok", {
    enumerable: true,
    get() {
      failIfNot(!!actual, `expected ${JSON.stringify(actual)} to be truthy`);
    },
  });
  Object.defineProperty(be, "true", {
    enumerable: true,
    get() {
      failIfNot(
        actual === true,
        `expected ${JSON.stringify(actual)} to be true`,
      );
    },
  });
  Object.defineProperty(be, "false", {
    enumerable: true,
    get() {
      failIfNot(
        actual === false,
        `expected ${JSON.stringify(actual)} to be false`,
      );
    },
  });
  Object.defineProperty(be, "null", {
    enumerable: true,
    get() {
      failIfNot(
        actual === null,
        `expected ${JSON.stringify(actual)} to be null`,
      );
    },
  });
  Object.defineProperty(be, "undefined", {
    enumerable: true,
    get() {
      failIfNot(
        actual === undefined,
        `expected ${JSON.stringify(actual)} to be undefined`,
      );
    },
  });
  Object.defineProperty(be, "empty", {
    enumerable: true,
    get() {
      let empty = false;
      if (actual == null) empty = true;
      else if (typeof actual === "string" || Array.isArray(actual))
        empty = (actual as { length: number }).length === 0;
      else if (typeof actual === "object")
        empty = Object.keys(actual as object).length === 0;
      failIfNot(empty, `expected ${JSON.stringify(actual)} to be empty`);
    },
  });
  be.a = (type: string) => {
    const t = Array.isArray(actual) ? "array" : typeof actual;
    failIfNot(t === type, `expected ${t} to be a ${type}`);
  };
  be.an = be.a;
  be.above = aboveFn;
  be.below = belowFn;
  be.greaterThan = aboveFn;
  be.lessThan = belowFn;

  const include = (expected: unknown) => {
    if (typeof actual === "string" && typeof expected === "string") {
      failIfNot(
        actual.includes(expected),
        `expected "${actual}" to include "${expected}"`,
      );
      return;
    }
    if (Array.isArray(actual)) {
      failIfNot(
        actual.includes(expected),
        `expected array to include ${JSON.stringify(expected)}`,
      );
      return;
    }
    if (
      actual &&
      typeof actual === "object" &&
      expected &&
      typeof expected === "object"
    ) {
      const a = actual as Record<string, unknown>;
      const e = expected as Record<string, unknown>;
      let allMatch = true;
      for (const k of Object.keys(e)) {
        if (JSON.stringify(a[k]) !== JSON.stringify(e[k])) {
          allMatch = false;
          break;
        }
      }
      failIfNot(
        allMatch,
        `expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`,
      );
      return;
    }
    throw new Error("include() only supports strings, arrays, and objects");
  };

  const matchFn = (re: RegExp) =>
    failIfNot(
      typeof actual === "string" && re.test(actual),
      `expected "${actual}" to match ${re}`,
    );

  const chain: ChainNode = {} as ChainNode;
  // `.to` is the gateway used in nearly every Chai expression. Both `.to`
  // and `.not` route back into a chain with the appropriate polarity.
  chain.to = {
    equal: equalFn,
    eql: eqlFn,
    include,
    match: matchFn,
    have,
    be,
    above: aboveFn,
    below: belowFn,
    greaterThan: aboveFn,
    lessThan: belowFn,
    lengthOf,
    deep: { equal: eqlFn },
    get not() {
      return buildChain(actual, !negate).to;
    },
  };
  // Top-level `.not` mirrors `.to.not` so `expect(x).not.to.equal(y)` works.
  Object.defineProperty(chain, "not", {
    enumerable: true,
    get() {
      return buildChain(actual, !negate);
    },
  });
  return chain;
}

/** Factory for the `pm.expect` callable. Just wraps `buildChain` so the
 *  worker module doesn't need to know about the negate flag. */
export function makeExpect() {
  return (actual: unknown): ChainNode => buildChain(actual, false);
}
