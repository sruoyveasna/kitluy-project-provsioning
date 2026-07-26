import { describe, expect, it } from "vitest";
import {
  assertLocalTarget,
  ConfigError,
  optionalString,
  requireEnvironment,
  requirePort,
  requireString,
} from "../src/index.js";

describe("@kitluy/shared-config", () => {
  it("fails closed on missing required variables", () => {
    expect(() => requireString({}, "SUPABASE_URL")).toThrow(ConfigError);
    expect(() => requireString({ SUPABASE_URL: "  " }, "SUPABASE_URL")).toThrow(/Fail closed/);
    expect(requireString({ SUPABASE_URL: "http://localhost:54321" }, "SUPABASE_URL")).toBe(
      "http://localhost:54321",
    );
  });

  it("validates ports", () => {
    expect(requirePort({ PORT: "8080" }, "PORT")).toBe(8080);
    expect(() => requirePort({ PORT: "abc" }, "PORT")).toThrow(ConfigError);
    expect(() => requirePort({ PORT: "70000" }, "PORT")).toThrow(ConfigError);
  });

  it("validates the KitLuy environment enum", () => {
    expect(requireEnvironment({ KITLUY_ENV: "staging" })).toBe("staging");
    expect(() => requireEnvironment({ KITLUY_ENV: "prod" })).toThrow(ConfigError);
  });

  it("optionalString falls back", () => {
    expect(optionalString({}, "X", "fallback")).toBe("fallback");
  });

  it("destructive local tooling refuses production-like targets", () => {
    expect(() => assertLocalTarget({ KITLUY_ENV: "production" })).toThrow(/Refusing/);
    expect(() => assertLocalTarget({ KITLUY_ENV: "pilot" })).toThrow(/Refusing/);
    expect(() =>
      assertLocalTarget({ KITLUY_ENV: "local", DATABASE_URL: "postgres://db.example.com/prod" }),
    ).toThrow(/non-local database/);
    expect(() =>
      assertLocalTarget({ KITLUY_ENV: "local", DATABASE_URL: "postgres://127.0.0.1:5432/dev" }),
    ).not.toThrow();
  });
});
