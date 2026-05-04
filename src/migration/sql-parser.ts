// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * SQL migration file parser.
 *
 * Parses .sql migration files with directive markers:
 *
 *   -- @transaction false
 *   -- @concurrent true
 *
 *   -- @up
 *   CREATE INDEX CONCURRENTLY "idx_users_email" ON "users" ("email");
 *
 *   -- @down
 *   DROP INDEX "idx_users_email";
 *
 * Directives before the first section marker are metadata. The @up and
 * @down markers delimit the SQL sections. Both are required.
 */

import type { Migration } from "./types.ts";

type ParseError = {
  readonly tag: "ParseError";
  readonly message: string;
  readonly filename: string;
};

type ParseState = {
  readonly directives: Map<string, string>;
  upLines: string[] | null;
  downLines: string[] | null;
  currentSection: "none" | "up" | "down";
  upCount: number;
  downCount: number;
};

const createParseError = (message: string, filename: string): ParseError =>
  Object.freeze({
    tag: "ParseError" as const,
    message: `SQL file "${filename}": ${message}`,
    filename,
  });

const handleSectionMarker = (state: ParseState, section: "up" | "down", filename: string): void => {
  if (section === "up") {
    if (state.upCount > 0) throw createParseError("duplicate @up section", filename);
    state.upCount++;
    state.currentSection = "up";
    state.upLines = [];
  } else {
    if (state.downCount > 0) throw createParseError("duplicate @down section", filename);
    state.downCount++;
    state.currentSection = "down";
    state.downLines = [];
  }
};

const handleDirective = (state: ParseState, trimmed: string): void => {
  const match = /^-- @(\w+)\s+(.+)$/.exec(trimmed);
  if (match === null) return;
  const key = match[1];
  const value = match[2];
  if (key !== undefined && value !== undefined) {
    state.directives.set(key.toLowerCase(), value.trim());
  }
};

const processLine = (state: ParseState, line: string, filename: string): void => {
  const trimmed = line.trim();

  if (trimmed === "-- @up") {
    handleSectionMarker(state, "up", filename);
    return;
  }
  if (trimmed === "-- @down") {
    handleSectionMarker(state, "down", filename);
    return;
  }

  if (state.currentSection === "none") {
    handleDirective(state, trimmed);
    return;
  }

  if (state.currentSection === "up" && state.upLines !== null) {
    state.upLines.push(line);
  } else if (state.currentSection === "down" && state.downLines !== null) {
    state.downLines.push(line);
  }
};

const validateSections = (state: ParseState, filename: string): { up: string; down: string } => {
  if (state.upLines === null) throw createParseError("missing @up section", filename);
  if (state.downLines === null) throw createParseError("missing @down section", filename);

  const up = state.upLines.join("\n").trim();
  const down = state.downLines.join("\n").trim();

  if (up.length === 0) throw createParseError("empty @up section", filename);
  if (down.length === 0) throw createParseError("empty @down section", filename);

  return { up, down };
};

/**
 * Parses a .sql migration file into a Migration object.
 *
 * Throws a descriptive error if the file is malformed (missing @up/@down,
 * empty sections, or duplicate markers).
 */
const parseSqlMigration = (content: string, filename: string): Migration => {
  const state: ParseState = {
    directives: new Map(),
    upLines: null,
    downLines: null,
    currentSection: "none",
    upCount: 0,
    downCount: 0,
  };

  for (const line of content.split("\n")) {
    processLine(state, line, filename);
  }

  const { up, down } = validateSections(state, filename);

  return Object.freeze({
    up,
    down,
    transaction: state.directives.get("transaction") !== "false",
    concurrent: state.directives.get("concurrent") === "true",
  });
};

export type { ParseError };
export { parseSqlMigration };
