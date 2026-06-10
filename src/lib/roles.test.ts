/**
 * Tests for the role helpers driven by ADMIN_EMAILS. (requireUser/requireAdmin
 * delegate to Supabase auth and are covered at the route layer.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminEmails, isAdminEmail, roleFor } from "./roles";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.ADMIN_EMAILS;
});
afterEach(() => {
  if (saved === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = saved;
});

describe("adminEmails", () => {
  it("parses, trims, lowercases, and drops blanks", () => {
    process.env.ADMIN_EMAILS = " A@x.com , b@Y.com ,, ";
    expect(adminEmails()).toEqual(["a@x.com", "b@y.com"]);
  });
  it("returns [] when unset", () => {
    delete process.env.ADMIN_EMAILS;
    expect(adminEmails()).toEqual([]);
  });
});

describe("isAdminEmail / roleFor", () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "boss@team.com";
  });
  it("matches case-insensitively", () => {
    expect(isAdminEmail("BOSS@team.com")).toBe(true);
    expect(roleFor("BOSS@team.com")).toBe("admin");
  });
  it("treats everyone else as a plain user", () => {
    expect(isAdminEmail("dev@team.com")).toBe(false);
    expect(roleFor("dev@team.com")).toBe("user");
    expect(isAdminEmail(null)).toBe(false);
    expect(roleFor(undefined)).toBe("user");
  });
});
