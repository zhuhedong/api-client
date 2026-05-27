import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards against accidentally adding duplicate keys inside the same JSON
 * object in locale files. JSON.parse silently drops earlier duplicates;
 * this caused real bugs where a translator updated one entry without
 * realizing a second one — declared later in the file — was the one
 * actually being used.
 *
 * We use a streaming-style line scanner because `JSON.parse` would also
 * happily eat duplicates and we want to fail the build instead.
 */
function findDuplicateKeysInScope(json: string): { line: number; key: string; firstLine: number }[] {
  const dupes: { line: number; key: string; firstLine: number }[] = [];
  const lines = json.split("\n");
  // Stack of scopes; each scope tracks `{ key -> firstLineNumber }`.
  const stack: Map<string, number>[] = [new Map()];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const keyMatch = trimmed.match(/^"([^"]+)"\s*:/);
    if (keyMatch) {
      const key = keyMatch[1];
      const top = stack[stack.length - 1];
      const first = top.get(key);
      if (first !== undefined) {
        dupes.push({ line: i + 1, key, firstLine: first });
      } else {
        top.set(key, i + 1);
      }
      // If the value on the same line opens an object (e.g. `"foo": {`),
      // push a fresh scope. We use brace counting below to handle this
      // generically rather than only for that single-line pattern.
    }
    const opens = (raw.match(/\{/g) || []).length;
    const closes = (raw.match(/\}/g) || []).length;
    // A "{" that appears on a line *after* a `"key":` introduces a new
    // sub-scope. Treat every net opening as a new scope.
    if (opens > closes) {
      for (let j = 0; j < opens - closes; j++) stack.push(new Map());
    } else if (closes > opens) {
      for (let j = 0; j < closes - opens; j++) stack.pop();
    }
  }
  return dupes;
}

describe("i18n locale files", () => {
  const localePaths = [
    resolve(__dirname, "locales/en.json"),
    resolve(__dirname, "locales/zh.json"),
  ];

  for (const path of localePaths) {
    it(`has no duplicate keys within scopes: ${path.split("/").slice(-2).join("/")}`, () => {
      const text = readFileSync(path, "utf8");
      const dupes = findDuplicateKeysInScope(text);
      expect(
        dupes,
        `Found duplicate keys in ${path}:\n${dupes.map((d) => `  line ${d.line}: "${d.key}" (first declared at line ${d.firstLine})`).join("\n")}`,
      ).toEqual([]);
    });

    it(`parses as valid JSON: ${path.split("/").slice(-2).join("/")}`, () => {
      const text = readFileSync(path, "utf8");
      expect(() => JSON.parse(text)).not.toThrow();
    });
  }
});
