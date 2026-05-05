// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "@igorjs/pure-test";
import { computeChecksum, normaliseContent } from "../src/migration/checksum.ts";

describe("normaliseContent", () => {
  it("trims whitespace", () => {
    expect(normaliseContent("  hello  ")).toBe("hello");
  });

  it("converts CRLF to LF", () => {
    expect(normaliseContent("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("converts lone CR to LF", () => {
    expect(normaliseContent("a\rb\rc")).toBe("a\nb\nc");
  });

  it("handles mixed line endings", () => {
    expect(normaliseContent("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});

describe("computeChecksum", () => {
  it("returns a hex string", () => {
    const hash = computeChecksum("hello");
    expect(/^[0-9a-f]+$/.test(hash)).toBeTruthy();
  });

  it("returns 64-char SHA-256 hex digest", () => {
    expect(computeChecksum("hello").length).toBe(64);
  });

  it("is deterministic", () => {
    expect(computeChecksum("test content")).toBe(computeChecksum("test content"));
  });

  it("differs for different content", () => {
    expect(computeChecksum("a")).not.toBe(computeChecksum("b"));
  });

  it("normalises before hashing (CRLF vs LF produce same hash)", () => {
    expect(computeChecksum("a\r\nb")).toBe(computeChecksum("a\nb"));
  });

  it("normalises whitespace (leading/trailing)", () => {
    expect(computeChecksum("  hello  ")).toBe(computeChecksum("hello"));
  });
});
