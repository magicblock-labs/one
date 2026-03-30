/**
 * ppaymulti
 *
 * Objective
 * =========
 * This script is a first-step concurrency harness for the private USDC transfer
 * flow tested by `ppay`. The goal is to simulate multiple users attempting
 * transfers at roughly the same time so we can observe whether a double-spend
 * style balance mismatch appears under concurrent load.
 *
 * Why this exists
 * ===============
 * Our single-user `ppay` flow is already useful for repeated private transfer
 * testing, slab-based balance checks, and selective data export on mismatch.
 * What it does not do is coordinate several independent users at once.
 *
 * `ppaymulti` starts multiple `ppay` child processes together, prefixes their
 * logs, and stores a multi-user run record under `store/multi/`.
 *
 * Current scope
 * =============
 * - Starter implementation only
 * - Exactly 5 users for now
 * - One JSON config file describes the users and shared transfer settings
 * - Each user maps to one `ppay` child process
 * - Optional per-user proxy/env fields are passed through, but proxy routing
 *   still depends on the underlying HTTP clients honoring those env vars
 *
 * Not done yet
 * ============
 * - Scenario generators (for example 2s->1r, mixed routing, 1s->2r)
 * - Shared global coordination of checkpoint timing
 * - Aggregated balance/result analysis across workers
 * - Robust proxy/session management
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { sleep } from "./network-retry.ts";

const ANSI_RESET = "\u001b[0m";
const ANSI_BOLD = "\u001b[1m";
const ANSI_DIM = "\u001b[2m";
const ANSI_RED = "\u001b[31m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_BLUE = "\u001b[34m";
const ANSI_MAGENTA = "\u001b[35m";
const ANSI_CYAN = "\u001b[36m";
const REQUIRED_USER_COUNT = 5;
const DEFAULT_START_DELAY_MS = 2_000;
const MULTI_STORE_DIR = "store/multi";

interface MultiUserConfig {
  amount: string;
  ntimes: number;
  startDelayMs?: number;
  sharedEnv?: Record<string, string>;
  users: MultiUserUserConfig[];
}

interface MultiUserUserConfig {
  id: string;
  from: string;
  to: string;
  env?: Record<string, string>;
  proxy?: string;
}

function colorize(value: string, color: string) {
  return `${color}${value}${ANSI_RESET}`;
}

function bold(value: string) {
  return `${ANSI_BOLD}${value}${ANSI_RESET}`;
}

function dim(value: string) {
  return `${ANSI_DIM}${value}${ANSI_RESET}`;
}

function printDivider() {
  console.log(dim("------------------------------------------------------------"));
}

function printSection(title: string, color = ANSI_CYAN) {
  printDivider();
  console.log(`${colorize("■", color)} ${bold(title)}`);
}

function printKeyValue(label: string, value: string, color = ANSI_BLUE) {
  console.log(`${colorize(label.padEnd(12), color)} ${value}`);
}

function printStatus(status: string, detail: string, color = ANSI_CYAN) {
  console.log(`${colorize(status, color)} ${detail}`);
}

function printUsage() {
  console.error("Usage: ppaymulti <config.json>");
  console.error("Example: ppaymulti ./multi-users.json");
  console.error("");
  console.error("Config requirements:");
  console.error(`  - exactly ${REQUIRED_USER_COUNT} users`);
  console.error("  - top-level amount and ntimes");
  console.error("  - each user has id, from, to");
}

function parsePositiveInteger(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return value;
}

function parseConfig(configPath: string) {
  const absolutePath = path.resolve(configPath);
  const raw = readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as MultiUserConfig;

  if (typeof parsed.amount !== "string" || parsed.amount.trim() === "") {
    throw new Error("config.amount must be a non-empty string");
  }

  const ntimes = parsePositiveInteger(parsed.ntimes, "config.ntimes");

  if (!Array.isArray(parsed.users) || parsed.users.length !== REQUIRED_USER_COUNT) {
    throw new Error(`config.users must contain exactly ${REQUIRED_USER_COUNT} entries`);
  }

  parsed.users.forEach((user, index) => {
    if (!user || typeof user !== "object") {
      throw new Error(`config.users[${index}] must be an object`);
    }
    if (typeof user.id !== "string" || user.id.trim() === "") {
      throw new Error(`config.users[${index}].id must be a non-empty string`);
    }
    if (typeof user.from !== "string" || user.from.trim() === "") {
      throw new Error(`config.users[${index}].from must be a non-empty string`);
    }
    if (typeof user.to !== "string" || user.to.trim() === "") {
      throw new Error(`config.users[${index}].to must be a non-empty string`);
    }
    if (user.proxy != null && (typeof user.proxy !== "string" || user.proxy.trim() === "")) {
      throw new Error(`config.users[${index}].proxy must be a non-empty string when set`);
    }
  });

  const duplicateIds = parsed.users
    .map((user) => user.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`config.users contains duplicate ids: ${duplicateIds.join(", ")}`);
  }

  return {
    absolutePath,
    config: {
      ...parsed,
      ntimes,
      startDelayMs:
        parsed.startDelayMs == null
          ? DEFAULT_START_DELAY_MS
          : parsePositiveInteger(parsed.startDelayMs, "config.startDelayMs"),
    },
  };
}

function getTimestampDirectoryName() {
  const now = new Date();
  const parts = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ];
  return parts.join("");
}

function prefixLines(prefix: string, chunk: string) {
  return chunk
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `${prefix} ${line}`);
}

async function runWorker(input: {
  runDirectory: string;
  amount: string;
  ntimes: number;
  sharedEnv?: Record<string, string>;
  user: MultiUserUserConfig;
}) {
  const scriptPath = path.join(process.cwd(), "scripts/ppay.ts");
  const logPath = path.join(input.runDirectory, `${input.user.id}.log`);
  const prefix = colorize(`[${input.user.id}]`, ANSI_MAGENTA);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(input.sharedEnv ?? {}),
    ...(input.user.env ?? {}),
  };

  if (input.user.proxy) {
    env.HTTP_PROXY = input.user.proxy;
    env.HTTPS_PROXY = input.user.proxy;
    env.ALL_PROXY = input.user.proxy;
  }

  const command = [
    process.execPath,
    "--experimental-strip-types",
    scriptPath,
    input.amount,
    input.user.from,
    input.user.to,
    String(input.ntimes),
  ];

  printStatus(
    "SPAWN",
    `${input.user.id} ${dim(command.slice(2).join(" "))}`,
    ANSI_YELLOW
  );

  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const appendLogLines = (lines: string[]) => {
      if (lines.length === 0) return;
      writeFileSync(logPath, `${lines.join("\n")}\n`, { flag: "a" });
      lines.forEach((line) => console.log(line));
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      appendLogLines(prefixLines(prefix, chunk));
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      appendLogLines(prefixLines(colorize(`[${input.user.id}:err]`, ANSI_RED), chunk));
    });

    child.on("close", (code, signal) => {
      const detail =
        code === 0
          ? `${input.user.id} completed`
          : `${input.user.id} exited code=${code ?? "null"} signal=${signal ?? "none"}`;
      printStatus(code === 0 ? "DONE " : "FAIL ", detail, code === 0 ? ANSI_GREEN : ANSI_RED);
      resolve({ code, signal });
    });
  });
}

async function main() {
  const [, , configPathArg] = process.argv;
  if (!configPathArg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { absolutePath, config } = parseConfig(configPathArg);
  const storeDir = path.join(process.cwd(), MULTI_STORE_DIR);
  const runDirectory = path.join(storeDir, getTimestampDirectoryName());
  mkdirSync(runDirectory, { recursive: true });

  writeFileSync(
    path.join(runDirectory, "config.json"),
    `${JSON.stringify({ sourceConfig: absolutePath, ...config }, null, 2)}\n`
  );

  printSection("ppaymulti", ANSI_CYAN);
  printKeyValue("Config", absolutePath);
  printKeyValue("Run Dir", runDirectory);
  printKeyValue("Users", bold(String(config.users.length)));
  printKeyValue("Amount", `${config.amount} USDC`);
  printKeyValue("Ntimes", String(config.ntimes));
  printKeyValue("Start In", `${config.startDelayMs}ms`);

  config.users.forEach((user, index) => {
    printKeyValue(
      `User ${index + 1}`,
      `${user.id} ${dim(`from=${user.from} to=${user.to}`)}`,
      ANSI_MAGENTA
    );
  });

  printStatus(
    "WAIT ",
    `Starting ${config.users.length} workers together in ${config.startDelayMs}ms`,
    ANSI_YELLOW
  );
  await sleep(config.startDelayMs);

  const results = await Promise.all(
    config.users.map((user) =>
      runWorker({
        runDirectory,
        amount: config.amount,
        ntimes: config.ntimes,
        sharedEnv: config.sharedEnv,
        user,
      })
    )
  );

  const failed = results.filter((result) => result.code !== 0);
  writeFileSync(
    path.join(runDirectory, "summary.json"),
    `${JSON.stringify(
      {
        startedUserCount: config.users.length,
        failedUserCount: failed.length,
        results,
      },
      null,
      2
    )}\n`
  );

  printSection("Summary", failed.length === 0 ? ANSI_GREEN : ANSI_RED);
  printKeyValue("Run Dir", runDirectory);
  printKeyValue("Failed", String(failed.length), failed.length === 0 ? ANSI_GREEN : ANSI_RED);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
