import { describe, expect, it } from "vitest";
import {
  buildChain,
  makeExpect,
  readonlyScopeApi,
  scopeApi,
} from "./scriptApi";

describe("scopeApi", () => {
  it("reads / writes / deletes against the underlying record", () => {
    const target: Record<string, string> = { existing: "v" };
    const api = scopeApi(target);

    expect(api.get("existing")).toBe("v");
    expect(api.has("existing")).toBe(true);
    expect(api.has("missing")).toBe(false);

    api.set("authToken", "abc");
    expect(target.authToken).toBe("abc");
    expect(api.get("authToken")).toBe("abc");

    api.unset("existing");
    expect("existing" in target).toBe(false);
    expect(api.has("existing")).toBe(false);
  });

  it("coerces non-string values to strings via String() (Postman parity)", () => {
    const target: Record<string, string> = {};
    const api = scopeApi(target);
    api.set("count", 42);
    api.set("flag", true);
    api.set("obj", { x: 1 });
    expect(target.count).toBe("42");
    expect(target.flag).toBe("true");
    expect(target.obj).toBe("[object Object]");
  });

  it("toObject() returns a defensive copy", () => {
    const target: Record<string, string> = { a: "1" };
    const api = scopeApi(target);
    const snap = api.toObject();
    snap.a = "mutated";
    expect(target.a).toBe("1");
  });

  it("clear() empties the target", () => {
    const target: Record<string, string> = { a: "1", b: "2" };
    scopeApi(target).clear();
    expect(target).toEqual({});
  });
});

describe("readonlyScopeApi", () => {
  it("supports get / has / toObject", () => {
    const data = { city: "Tokyo", id: "42" };
    const api = readonlyScopeApi(data, "pm.iterationData");
    expect(api.get("city")).toBe("Tokyo");
    expect(api.has("missing")).toBe(false);
    expect(api.toObject()).toEqual(data);
  });

  it("throws with the scope name when set / unset are called", () => {
    const api = readonlyScopeApi({}, "pm.iterationData");
    expect(() => api.set("x", "y")).toThrow("pm.iterationData is read-only");
    expect(() => api.unset("x")).toThrow("pm.iterationData is read-only");
  });
});

describe("buildChain — Chai-flavoured expect()", () => {
  const expect2 = makeExpect();

  describe("basics", () => {
    it("equal — strict equality, passes on match, throws on miss", () => {
      expect2(1).to.equal(1);
      expect(() => expect2(1).to.equal(2)).toThrow(/to equal/);
    });

    it("eql — deep equality via JSON canonicalization", () => {
      expect2({ a: 1, b: [2, 3] }).to.eql({ a: 1, b: [2, 3] });
      expect(() => expect2({ a: 1 }).to.eql({ a: 2 })).toThrow(
        /to deeply equal/,
      );
    });

    it("deep.equal — alias for eql", () => {
      expect2({ x: 1 }).to.deep.equal({ x: 1 });
      expect(() => expect2({ x: 1 }).to.deep.equal({ x: 2 })).toThrow(
        /to deeply equal/,
      );
    });
  });

  describe("status / property / have", () => {
    it(".to.have.status(n) — passes when response.status matches", () => {
      expect2({ status: 200 }).to.have.status(200);
      expect(() => expect2({ status: 200 }).to.have.status(404)).toThrow(
        /status 404/,
      );
    });

    it(".to.have.property(k)", () => {
      expect2({ id: 1 }).to.have.property("id");
      expect(() => expect2({ id: 1 }).to.have.property("name")).toThrow(
        /property "name"/,
      );
    });
  });

  describe("length / lengthOf", () => {
    it(".to.have.lengthOf(n) — exposes object-/string-/array-length", () => {
      expect2([1, 2, 3]).to.have.lengthOf(3);
      expect2("abc").to.have.lengthOf(3);
      expect(() => expect2([1, 2]).to.have.lengthOf(5)).toThrow(/length 2/);
    });

    it(".to.lengthOf(n) — alias on the to-root", () => {
      expect2([1, 2]).to.lengthOf(2);
    });
  });

  describe("above / below / greaterThan / lessThan", () => {
    it(".to.be.above(n)", () => {
      expect2(10).to.be.above(5);
      expect(() => expect2(1).to.be.above(5)).toThrow(/above 5/);
    });

    it(".to.be.below(n)", () => {
      expect2(1).to.be.below(5);
      expect(() => expect2(10).to.be.below(5)).toThrow(/below 5/);
    });

    it(".to.be.greaterThan / .to.be.lessThan are aliases", () => {
      expect2(10).to.be.greaterThan(1);
      expect2(1).to.be.lessThan(10);
    });
  });

  describe("be.ok / true / false / null / undefined", () => {
    it("truthy / falsy assertions trigger via property access", () => {
      expect2(1).to.be.ok;
      expect(() => expect2(0).to.be.ok).toThrow();
      expect2(true).to.be.true;
      expect2(false).to.be.false;
      expect2(null).to.be.null;
      expect2(undefined).to.be.undefined;
      expect(() => expect2(null).to.be.true).toThrow();
    });

    it(".to.be.a(type) / .to.be.an(type) — typeof check, with array specialization", () => {
      expect2("x").to.be.a("string");
      expect2(1).to.be.a("number");
      expect2([]).to.be.an("array");
      expect(() => expect2([]).to.be.a("object")).toThrow();
    });
  });

  describe("be.empty", () => {
    it("treats null / undefined / empty string / [] / {} as empty", () => {
      expect2(null).to.be.empty;
      expect2(undefined).to.be.empty;
      expect2("").to.be.empty;
      expect2([]).to.be.empty;
      expect2({}).to.be.empty;
    });

    it("rejects non-empty values", () => {
      expect(() => expect2("x").to.be.empty).toThrow();
      expect(() => expect2([1]).to.be.empty).toThrow();
      expect(() => expect2({ a: 1 }).to.be.empty).toThrow();
    });
  });

  describe("include", () => {
    it("string-in-string", () => {
      expect2("hello world").to.include("world");
      expect(() => expect2("hello").to.include("bye")).toThrow();
    });

    it("member-in-array", () => {
      expect2([1, 2, 3]).to.include(2);
      expect(() => expect2([1, 2, 3]).to.include(99)).toThrow();
    });

    it("subset-of-object", () => {
      expect2({ a: 1, b: 2, c: 3 }).to.include({ a: 1, b: 2 });
      expect(() => expect2({ a: 1 }).to.include({ a: 2 })).toThrow();
    });
  });

  describe("match", () => {
    it("regex against a string", () => {
      expect2("hello 42").to.match(/\d+/);
      expect(() => expect2("hello").to.match(/\d+/)).toThrow();
    });
  });

  describe("not — negation", () => {
    it("expect(x).to.not.equal(y) — passes when they differ", () => {
      expect2(1).to.not.equal(2);
      expect(() => expect2(1).to.not.equal(1)).toThrow(/expected NOT/);
    });

    it("expect(x).not.to.equal(y) — top-level alias", () => {
      expect2(1).not.to.equal(2);
      expect(() => expect2(1).not.to.equal(1)).toThrow(/expected NOT/);
    });

    it("inverts include / match too", () => {
      expect2("hello").to.not.include("bye");
      expect2("hello").to.not.match(/\d+/);
      expect(() => expect2("hello").to.not.include("hello")).toThrow();
    });
  });

  describe("low-level buildChain — exposes negate flag", () => {
    it("buildChain(x, true) — pre-negated chain", () => {
      buildChain(1, true).to.equal(2);
      expect(() => buildChain(1, true).to.equal(1)).toThrow();
    });
  });
});
