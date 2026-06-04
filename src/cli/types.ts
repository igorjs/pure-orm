// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * CLI configuration and command context types.
 */

import type { Model } from "../model/define.ts";

type PureOrmConfig = {
  readonly dialect: "postgresql" | "sqlite";
  readonly connection: {
    readonly host?: string;
    readonly port?: number;
    readonly database: string;
    readonly user?: string;
    readonly password?: string;
    readonly ssl?: boolean;
    readonly filename?: string;
  };
  readonly migrations: {
    readonly directory: string;
  };
  readonly models?: () => readonly Model[];
};

type CliFlags = {
  readonly dryRun: boolean;
  readonly verbose: boolean;
  readonly force: boolean;
  readonly allowDestructive: boolean;
  readonly configPath: string | null;
  readonly step: number | null;
};

type CommandContext = {
  readonly config: PureOrmConfig;
  readonly flags: CliFlags;
};

type CommandFn = (ctx: CommandContext) => Promise<number>;

export type { CliFlags, CommandContext, CommandFn, PureOrmConfig };
