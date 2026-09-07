import { describe, expect, it } from "vitest";
import {
  CROCKFORD_BASE32,
  emptyCodeEntry,
  feedCodeEntry,
  normalizeCodeChar,
  reduceCodeEntry,
} from "../src/model/code-entry.js";

describe("normalizeCodeChar", () => {
  it("accepts alphabet characters and folds case", () => {
    expect(normalizeCodeChar("A")).toBe("A");
    expect(normalizeCodeChar("z")).toBe("Z");
    expect(normalizeCodeChar("7")).toBe("7");
  });

  it("maps Crockford confusions I/L -> 1 and O -> 0", () => {
    expect(normalizeCodeChar("I")).toBe("1");
    expect(normalizeCodeChar("l")).toBe("1");
    expect(normalizeCodeChar("o")).toBe("0");
  });

  it("ignores U (no canonical mapping, never in a code)", () => {
    expect(normalizeCodeChar("U")).toBeNull();
    expect(normalizeCodeChar("u")).toBeNull();
  });

  it("ignores separators, control bytes and multi-char input", () => {
    expect(normalizeCodeChar(" ")).toBeNull();
    expect(normalizeCodeChar("-")).toBeNull();
    expect(normalizeCodeChar("\n")).toBeNull();
    expect(normalizeCodeChar("AB")).toBeNull();
    expect(normalizeCodeChar("")).toBeNull();
  });
});

describe("reduceCodeEntry", () => {
  const key = (state: ReturnType<typeof reduceCodeEntry>, char: string) =>
    reduceCodeEntry(state, { kind: "key", char });

  it("accumulates accepted characters and reports completion at length 8", () => {
    let s = emptyCodeEntry;
    for (const c of "R7K4M2PQ") s = key(s, c);
    expect(s.value).toBe("R7K4M2PQ");
    expect(s.complete).toBe(true);
  });

  it("is incomplete below the length", () => {
    let s = emptyCodeEntry;
    for (const c of "R7K4") s = key(s, c);
    expect(s.value).toBe("R7K4");
    expect(s.complete).toBe(false);
  });

  it("drops overflow once the code is complete", () => {
    let s = emptyCodeEntry;
    for (const c of "R7K4M2PQ") s = key(s, c);
    const after = key(s, "9");
    expect(after.value).toBe("R7K4M2PQ");
    expect(after.complete).toBe(true);
  });

  it("normalises as it accepts", () => {
    let s = emptyCodeEntry;
    for (const c of "iloILO") s = key(s, c); // -> 1 1 0 1 1 0
    expect(s.value).toBe("110110");
  });

  it("ignores out-of-alphabet keys without advancing", () => {
    let s = emptyCodeEntry;
    s = key(s, "A");
    s = key(s, " ");
    s = key(s, "U");
    s = key(s, "B");
    expect(s.value).toBe("AB");
  });

  it("backspace removes one character and clears completion", () => {
    let s = emptyCodeEntry;
    for (const c of "R7K4M2PQ") s = key(s, c);
    expect(s.complete).toBe(true);
    s = reduceCodeEntry(s, { kind: "backspace" });
    expect(s.value).toBe("R7K4M2P");
    expect(s.complete).toBe(false);
  });

  it("backspace on empty is a no-op", () => {
    expect(reduceCodeEntry(emptyCodeEntry, { kind: "backspace" })).toEqual(emptyCodeEntry);
  });

  it("clear resets to empty", () => {
    let s = emptyCodeEntry;
    for (const c of "R7K4") s = key(s, c);
    expect(reduceCodeEntry(s, { kind: "clear" })).toEqual(emptyCodeEntry);
  });
});

describe("feedCodeEntry (USB keyboard-wedge scanner)", () => {
  it("accepts a grouped, hyphenated burst with a trailing newline and completes", () => {
    const s = feedCodeEntry(emptyCodeEntry, "r7k4-m2pq\n");
    expect(s.value).toBe("R7K4M2PQ");
    expect(s.complete).toBe(true);
  });

  it("a short burst stays incomplete so the screen will not submit", () => {
    const s = feedCodeEntry(emptyCodeEntry, "R7K4");
    expect(s.complete).toBe(false);
  });

  it("the format is Crockford Base32, length 8", () => {
    expect(CROCKFORD_BASE32.length).toBe(8);
    expect(CROCKFORD_BASE32.alphabet).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    expect(CROCKFORD_BASE32.alphabet).not.toMatch(/[ILOU]/);
  });
});
