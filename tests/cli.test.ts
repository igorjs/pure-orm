// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

import { execSync } from "node:child_process";
import { describe, expect, it } from "@igorjs/pure-test";

const runCli = (args: string): { stdout: string; exitCode: number } => {
  try {
    const stdout = execSync(`node --import tsx --no-warnings src/cli/index.ts ${args}`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout: string; stderr: string; status: number };
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), exitCode: e.status ?? 1 };
  }
};

describe("CLI end-to-end", () => {
  it("--help prints usage and exits 0", () => {
    const { stdout, exitCode } = runCli("--help");
    expect(exitCode).toBe(0);
    expect(stdout.includes("pure-orm")).toBeTruthy();
    expect(stdout.includes("migrate:up")).toBeTruthy();
    expect(stdout.includes("migrate:down")).toBeTruthy();
    expect(stdout.includes("migrate:status")).toBeTruthy();
    expect(stdout.includes("migrate:generate")).toBeTruthy();
    expect(stdout.includes("migrate:validate")).toBeTruthy();
  });

  it("--version prints a semver version and exits 0", () => {
    const { stdout, exitCode } = runCli("--version");
    expect(exitCode).toBe(0);
    expect(/^\d+\.\d+\.\d+/.test(stdout.trim())).toBeTruthy();
  });

  it("unknown command prints error and exits 1", () => {
    const { stdout, exitCode } = runCli("migrate:nonexistent");
    expect(exitCode).toBe(1);
    expect(stdout.includes("Unknown command")).toBeTruthy();
  });

  it("missing config file prints error and exits 1", () => {
    const { stdout, exitCode } = runCli("migrate:status --config /tmp/nonexistent-config.ts");
    expect(exitCode).toBe(1);
    expect(stdout.includes("not found")).toBeTruthy();
  });

  it("no arguments prints usage and exits 1", () => {
    const { stdout, exitCode } = runCli("");
    expect(exitCode).toBe(1);
    expect(stdout.includes("pure-orm")).toBeTruthy();
  });
});
