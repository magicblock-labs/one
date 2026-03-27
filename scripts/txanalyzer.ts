import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { Connection, PublicKey } from "@solana/web3.js";
import { sleep, withNetworkRetry } from "./network-retry.ts";

const ER_RPC_ENDPOINT = "https://devnet.magicblock.app";
const ANSI_RESET = "\u001b[0m";
const ANSI_BOLD = "\u001b[1m";
const ANSI_RED = "\u001b[31m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_CYAN = "\u001b[36m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_DIM = "\u001b[2m";
const SHUTTLE_DELAY_MS = 500;
const RPC_TIMEOUT_MS = 20_000;
const SIGNATURE_PAGE_LIMIT = 1000;

interface TxDump {
  address: string;
  baselineSlot: number;
  newTransactionCount: number;
  transactions: Array<{
    signature: string;
    slot: number;
    transaction?: {
      meta?: {
        logMessages?: string[] | null;
      } | null;
    } | null;
  }>;
}

interface ShuttleWalletDump {
  erRpcEndpoint: string;
  sourceFile: string;
  sourceAddress: string;
  shuttleWalletCount: number;
  shuttleWallets: Array<{
    shuttleWallet: string;
    sourceOccurrences: Array<{
      sourceSignature: string;
      sourceSlot: number;
      logLine: string;
    }>;
    transactionCount: number;
    transactions: Array<{
      blockTime: number | null;
      confirmationStatus?: string;
      err: unknown;
      memo: string | null;
      signature: string;
      slot: number;
      transaction?: {
        meta?: {
          logMessages?: string[] | null;
        } | null;
      } | null;
    }>;
  }>;
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

function usage() {
  console.error("Usage: txanalyzer <mode> <run-directory>");
  console.error("Modes:");
  console.error("  fetch-shuttle  Fetch shuttle wallet transactions from from_tx.json");
  console.error("  actions-sig    Read from_shuttle_wallet.json and print sorted actions_tx_sig values");
  console.error("Examples:");
  console.error("  txanalyzer fetch-shuttle store/4.451349229_451349230_451349230");
  console.error("  txanalyzer actions-sig store/4.451349229_451349230_451349230");
}

function logWait(reason: string, ms: number) {
  console.log(`${colorize("WAIT", ANSI_YELLOW)} ${reason} ${ms}ms`);
}

async function withRpcRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  return withNetworkRetry(
    () =>
      Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${RPC_TIMEOUT_MS}ms`)), RPC_TIMEOUT_MS)
        ),
      ]),
    ({ attempt, delayMs, message }) => {
      console.log(
        `${colorize("RPC ", ANSI_YELLOW)} ${label} failed (${message}). Waiting ${delayMs}ms before retry ${attempt + 1}`
      );
    },
    () => true
  );
}

function getRunDirectory(inputPath: string) {
  const resolved = path.resolve(inputPath);
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`${resolved} is not a directory`);
  }

  return resolved;
}

function readTxDump(filePath: string) {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as TxDump;
}

function readShuttleWalletDump(filePath: string) {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as ShuttleWalletDump;
}

function extractShuttleWallets(dump: TxDump) {
  const shuttleWalletMap = new Map<
    string,
    {
      sourceSignature: string;
      sourceSlot: number;
      logLine: string;
    }[]
  >();

  for (const tx of dump.transactions ?? []) {
    const logMessages = tx.transaction?.meta?.logMessages ?? [];
    for (const logLine of logMessages) {
      if (!logLine.includes("Private shuttle ix accounts")) continue;

      const match = logLine.match(/shuttle_wallet=([1-9A-HJ-NP-Za-km-z]{32,44})/);
      if (!match?.[1]) continue;

      const entries = shuttleWalletMap.get(match[1]) ?? [];
      entries.push({
        sourceSignature: tx.signature,
        sourceSlot: tx.slot,
        logLine,
      });
      shuttleWalletMap.set(match[1], entries);
    }
  }

  return Array.from(shuttleWalletMap.entries())
    .map(([shuttleWallet, sources]) => ({
      shuttleWallet,
      sources,
    }))
    .sort((left, right) => left.shuttleWallet.localeCompare(right.shuttleWallet));
}

function printShuttleWalletSummary(
  shuttleWallets: Array<{
    shuttleWallet: string;
    sources: Array<{
      sourceSignature: string;
      sourceSlot: number;
      logLine: string;
    }>;
  }>
) {
  const repeated = shuttleWallets.filter((item) => item.sources.length > 1);

  console.log(
    `${colorize("INFO", ANSI_CYAN)} found ${bold(String(shuttleWallets.length))} unique shuttle wallet(s)`
  );

  if (repeated.length === 0) {
    console.log(colorize("UNIQ all shuttle_wallet values are unique in from_tx.json", ANSI_GREEN));
    return;
  }

  console.log(
    colorize(
      `NONUQ found ${repeated.length} non-unique shuttle wallet(s); duplicate shuttle_wallet values exist`,
      ANSI_RED
    )
  );

  for (const item of repeated) {
    console.log(`${ANSI_BOLD}${ANSI_RED}${item.shuttleWallet}${ANSI_RESET}`);
    item.sources.forEach((source, index) => {
      console.log(
        `  hit ${index + 1}: slot=${source.sourceSlot} signature=${source.sourceSignature}`
      );
    });
  }
}

async function getAllTransactionsForAddress(connection: Connection, address: PublicKey) {
  const signatures: Array<{
    blockTime: number | null;
    confirmationStatus?: string;
    err: unknown;
    memo: string | null;
    signature: string;
    slot: number;
  }> = [];
  let before: string | undefined;
  let pageNumber = 0;
  const seenSignatures = new Set<string>();
  const seenBeforeCursors = new Set<string>();

  while (true) {
    pageNumber += 1;
    if (before) {
      if (seenBeforeCursors.has(before)) {
        console.log(
          `${colorize("STOP ", ANSI_YELLOW)} ${address.toBase58()} repeated cursor ${before}; stopping pagination`
        );
        break;
      }
      seenBeforeCursors.add(before);
    }

    console.log(
      `${colorize("PAGE ", ANSI_CYAN)} ${address.toBase58()} page ${pageNumber} ${dim(
        `(before=${before ?? "none"})`
      )}`
    );
    const page = await withRpcRetry(
      () =>
        connection.getSignaturesForAddress(
          address,
          { before, limit: SIGNATURE_PAGE_LIMIT },
          "confirmed"
        ),
      `signatures for ${address.toBase58()}`
    );

    if (page.length === 0) {
      console.log(`${colorize("PAGE ", ANSI_CYAN)} ${address.toBase58()} page ${pageNumber} returned 0`);
      break;
    }

    let addedOnThisPage = 0;
    for (const item of page) {
      if (seenSignatures.has(item.signature)) {
        continue;
      }

      seenSignatures.add(item.signature);
      signatures.push({
        blockTime: item.blockTime,
        confirmationStatus: item.confirmationStatus ?? undefined,
        err: item.err,
        memo: item.memo,
        signature: item.signature,
        slot: item.slot,
      });
      addedOnThisPage += 1;
    }

    console.log(
      `${colorize("PAGE ", ANSI_CYAN)} ${address.toBase58()} page ${pageNumber} got ${page.length} signatures, added ${addedOnThisPage}, total ${signatures.length}`
    );

    if (addedOnThisPage === 0) {
      console.log(
        `${colorize("STOP ", ANSI_YELLOW)} ${address.toBase58()} page ${pageNumber} added no new signatures; stopping pagination`
      );
      break;
    }

    before = page[page.length - 1]?.signature;
    if (!before) break;
  }

  const transactions = [];
  for (const [index, signatureInfo] of signatures.entries()) {
    const parsed = await withRpcRetry(
      () =>
        connection.getParsedTransaction(signatureInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }),
      `parsed tx ${signatureInfo.signature}`
    );
    transactions.push({
      ...signatureInfo,
      transaction: parsed,
    });

    if ((index + 1) % 25 === 0 || index + 1 === signatures.length) {
      console.log(
        `${colorize("PARSE", ANSI_CYAN)} ${address.toBase58()} parsed ${index + 1}/${signatures.length}`
      );
    }
  }

  return transactions;
}

async function runFetchShuttle(runDirectory: string) {
  const fromTxPath = path.join(runDirectory, "from_tx.json");
  const fromTxDump = readTxDump(fromTxPath);
  const shuttleWallets = extractShuttleWallets(fromTxDump);

  console.log(`${colorize("■", ANSI_CYAN)} ${bold("Shuttle Wallet Analyzer")}`);
  console.log(`${colorize("MODE", ANSI_CYAN)} fetch-shuttle`);
  console.log(`${colorize("DIR ", ANSI_CYAN)} ${runDirectory}`);
  console.log(`${colorize("SRC ", ANSI_CYAN)} ${fromTxPath}`);
  console.log(`${colorize("RPC ", ANSI_CYAN)} ${ER_RPC_ENDPOINT}`);

  if (shuttleWallets.length === 0) {
    console.log(colorize("No shuttle_wallet entries found in from_tx.json.", ANSI_YELLOW));
    return;
  }

  printShuttleWalletSummary(shuttleWallets);

  const connection = new Connection(ER_RPC_ENDPOINT, "confirmed");
  const aggregated = [];

  for (const [index, shuttle] of shuttleWallets.entries()) {
    console.log(
      `${colorize("FETCH", ANSI_CYAN)} ${index + 1}/${shuttleWallets.length} ${shuttle.shuttleWallet}`
    );
    const transactions = await getAllTransactionsForAddress(
      connection,
      new PublicKey(shuttle.shuttleWallet)
    );
    console.log(
      `  ${colorize("TXS", ANSI_GREEN)} ${transactions.length} ${ANSI_DIM}source hits=${shuttle.sources.length}${ANSI_RESET}`
    );

    aggregated.push({
      shuttleWallet: shuttle.shuttleWallet,
      sourceOccurrences: shuttle.sources,
      transactionCount: transactions.length,
      transactions,
    });

    if (index + 1 < shuttleWallets.length) {
      logWait("before next shuttle wallet", SHUTTLE_DELAY_MS);
      await sleep(SHUTTLE_DELAY_MS);
    }
  }

  const outputPath = path.join(runDirectory, "from_shuttle_wallet.json");
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        erRpcEndpoint: ER_RPC_ENDPOINT,
        sourceFile: "from_tx.json",
        sourceAddress: fromTxDump.address,
        shuttleWalletCount: aggregated.length,
        shuttleWallets: aggregated,
      },
      null,
      2
    )}\n`
  );

  console.log("");
  console.log(`${colorize("SAVE", ANSI_GREEN)} ${outputPath}`);
}

function extractActionSignatures(dump: ShuttleWalletDump) {
  const actionSignatureCounts = new Map<string, number>();

  for (const shuttleWallet of dump.shuttleWallets ?? []) {
    for (const tx of shuttleWallet.transactions ?? []) {
      const logMessages = tx.transaction?.meta?.logMessages ?? [];
      for (const logLine of logMessages) {
        for (const match of logLine.matchAll(/actions_tx_sig=([1-9A-HJ-NP-Za-km-z]{32,88})/g)) {
          if (match[1]) {
            actionSignatureCounts.set(match[1], (actionSignatureCounts.get(match[1]) ?? 0) + 1);
          }
        }
      }
    }
  }

  const signatures = Array.from(actionSignatureCounts.keys()).sort((left, right) =>
    left.localeCompare(right)
  );
  const duplicates = signatures
    .map((signature) => ({
      signature,
      count: actionSignatureCounts.get(signature) ?? 0,
    }))
    .filter((item) => item.count > 1);

  return {
    duplicates,
    signatureCounts: actionSignatureCounts,
    signatures,
  };
}

function runActionsSig(runDirectory: string) {
  const shuttleWalletPath = path.join(runDirectory, "from_shuttle_wallet.json");
  const shuttleWalletDump = readShuttleWalletDump(shuttleWalletPath);
  const actionSignatures = extractActionSignatures(shuttleWalletDump);

  console.log(`${colorize("■", ANSI_CYAN)} ${bold("Shuttle Wallet Analyzer")}`);
  console.log(`${colorize("MODE", ANSI_CYAN)} actions-sig`);
  console.log(`${colorize("DIR ", ANSI_CYAN)} ${runDirectory}`);
  console.log(`${colorize("SRC ", ANSI_CYAN)} ${shuttleWalletPath}`);
  console.log(
    `${colorize("INFO", ANSI_CYAN)} found ${bold(String(actionSignatures.signatures.length))} unique actions_tx_sig value(s)`
  );

  if (actionSignatures.duplicates.length === 0) {
    console.log(colorize("UNIQ all actions_tx_sig values are unique", ANSI_GREEN));
  } else {
    console.log(
      colorize(
        `DUPL found ${actionSignatures.duplicates.length} duplicated actions_tx_sig value(s)`,
        ANSI_RED
      )
    );
    for (const duplicate of actionSignatures.duplicates) {
      console.log(`${ANSI_BOLD}${ANSI_RED}${duplicate.signature}${ANSI_RESET} count=${duplicate.count}`);
    }
  }

  const indexWidth = String(actionSignatures.signatures.length).length;
  for (const [index, signature] of actionSignatures.signatures.entries()) {
    console.log(`${String(index + 1).padStart(indexWidth, " ")}. ${signature}`);
  }
}

async function main() {
  const [, , modeArg, runDirectoryArg] = process.argv;
  if (!modeArg || !runDirectoryArg) {
    usage();
    process.exitCode = 1;
    return;
  }

  const runDirectory = getRunDirectory(runDirectoryArg);

  if (modeArg === "fetch-shuttle") {
    await runFetchShuttle(runDirectory);
    return;
  }

  if (modeArg === "actions-sig") {
    runActionsSig(runDirectory);
    return;
  }

  throw new Error(`Unknown mode: ${modeArg}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${ANSI_BOLD}${ANSI_RED}${message}${ANSI_RESET}`);
  process.exitCode = 1;
});
