import { describe, it, expect } from "vitest";
import { safeWorkspacePath, WORKSPACE_ROOT } from "./workspace-path";

describe("safeWorkspacePath", () => {
  it("passes through clean relative paths", () => {
    expect(safeWorkspacePath("src/index.ts")).toBe("src/index.ts");
    expect(safeWorkspacePath("README.md")).toBe("README.md");
  });

  it("treats root spellings as the empty root path", () => {
    expect(safeWorkspacePath(".")).toBe(WORKSPACE_ROOT);
    expect(safeWorkspacePath("")).toBe(WORKSPACE_ROOT);
    expect(safeWorkspacePath("./")).toBe(WORKSPACE_ROOT);
  });

  it("collapses redundant separators and dot segments", () => {
    expect(safeWorkspacePath("src//lib/./a.ts")).toBe("src/lib/a.ts");
    expect(safeWorkspacePath("a/b/")).toBe("a/b");
    expect(safeWorkspacePath("src\\lib\\a.ts")).toBe("src/lib/a.ts");
  });

  it("rejects absolute paths", () => {
    expect(safeWorkspacePath("/etc/passwd")).toBeNull();
    expect(safeWorkspacePath("/")).toBeNull();
  });

  it("rejects parent-traversal escapes anywhere in the path", () => {
    expect(safeWorkspacePath("..")).toBeNull();
    expect(safeWorkspacePath("../secrets")).toBeNull();
    expect(safeWorkspacePath("src/../../etc")).toBeNull();
    expect(safeWorkspacePath("a/b/../../../c")).toBeNull();
  });

  it("rejects NUL bytes and non-strings", () => {
    expect(safeWorkspacePath("a\0b")).toBeNull();
    expect(safeWorkspacePath(null)).toBeNull();
    expect(safeWorkspacePath(undefined)).toBeNull();
    expect(safeWorkspacePath(42)).toBeNull();
  });
});
