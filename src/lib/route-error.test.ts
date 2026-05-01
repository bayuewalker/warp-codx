/**
 * Task #35 — Direct unit tests for `statusFromAdapterError`.
 *
 * The route layer relies on this helper to translate the adapter's
 * sanitized `github_<op>_<status>: ...` messages back into HTTP
 * statuses. This file pins the contract — any change to the
 * pass-through set is intentional and observable.
 */
import { describe, expect, it } from "vitest";
import { statusFromAdapterError } from "./route-error";

describe("statusFromAdapterError — pass-through 4xx", () => {
  const cases: Array<{ msg: string; expected: number }> = [
    { msg: "github_list_401: HttpError: Bad credentials", expected: 401 },
    { msg: "github_list_404: HttpError: Not Found", expected: 404 },
    { msg: "github_list_422: HttpError: Validation Failed", expected: 422 },
    { msg: "github_detail_401: HttpError: Bad credentials", expected: 401 },
    { msg: "github_detail_404: HttpError: Not Found", expected: 404 },
    { msg: "github_detail_422: HttpError: Validation Failed", expected: 422 },
    {
      msg: "github_merge_403: PAT missing pull_requests:write — re-grant in repo settings",
      expected: 403,
    },
    {
      msg: "github_merge_404: HttpError: Not Found",
      expected: 404,
    },
    {
      msg: "github_merge_405: PR not mergeable (already merged, conflict, or branch protection)",
      expected: 405,
    },
    {
      msg: "github_merge_422: HttpError: Validation Failed",
      expected: 422,
    },
    { msg: "github_close_404: HttpError: Not Found", expected: 404 },
    { msg: "github_close_422: HttpError: Validation Failed", expected: 422 },
    { msg: "github_hold_401: HttpError: Bad credentials", expected: 401 },
    { msg: "github_hold_404: HttpError: Not Found", expected: 404 },
  ];

  for (const { msg, expected } of cases) {
    it(`maps "${msg.split(":")[0]}" → ${expected}`, () => {
      expect(statusFromAdapterError(msg)).toBe(expected);
    });
  }
});

describe("statusFromAdapterError — 500 fall-through", () => {
  it("returns 500 for the `github_<op>_x: ...` legacy fall-through (status unknown)", () => {
    // sanitize() emits `_x` when err.status is missing/0.
    expect(
      statusFromAdapterError("github_list_x: Error: unknown"),
    ).toBe(500);
  });

  it("returns 500 for any sanitized status NOT in the pass-through set", () => {
    expect(statusFromAdapterError("github_list_500: HttpError: boom")).toBe(
      500,
    );
    expect(statusFromAdapterError("github_merge_502: HttpError: gateway")).toBe(
      500,
    );
    expect(statusFromAdapterError("github_detail_409: HttpError: conflict")).toBe(
      500,
    );
  });

  it("returns 500 for messages without the `github_<op>_<status>:` prefix", () => {
    expect(statusFromAdapterError("github list failed")).toBe(500);
    expect(statusFromAdapterError("Error: random failure")).toBe(500);
    expect(statusFromAdapterError("")).toBe(500);
  });

  it("never throws on adversarial input", () => {
    expect(() => statusFromAdapterError("\\b404\\b")).not.toThrow();
    expect(() => statusFromAdapterError("github__404:")).not.toThrow();
    expect(() => statusFromAdapterError("github_list_:")).not.toThrow();
  });
});
