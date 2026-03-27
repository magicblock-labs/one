import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import bs58 from "bs58";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getBackoffDelayMs, sleep, withNetworkRetry } from "./network-retry.ts";

const DEFAULT_PAYMENTS_API_BASE_URL = "https://payments.magicblock.app";
const DEFAULT_PAYMENTS_CLUSTER = "devnet";
const DEFAULT_MAINNET_RPC_ENDPOINT = "https://rpc.magicblock.app/mainnet";
const DEFAULT_DEVNET_RPC_ENDPOINT = "https://api.devnet.solana.com";
const DEFAULT_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const DEFAULT_MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEVNET_VAULT = "TEy2XnwbueFzCMTAJhgxa4vrWb3N1Dhe4ANy4CgVr3r";
const STORE_DIR = "store";
const MAX_PRIVATE_DELAY_MS = 30 * 60 * 1000;
const USDC_DECIMALS = 6;
const TRANSFER_DELAY_MS = 500;
const CHECKPOINT_INTERVAL = 10;
const CHECKPOINT_DELAY_MS = 10_000;
const BALANCE_SETTLE_ATTEMPTS = 5;
const BALANCE_SETTLE_DELAY_MS = 500;
const EXPORT_SETTLE_DELAY_MS = 2_000;
const EXPORT_PAGE_DELAY_MS = 400;
const EXPORT_TX_DELAY_MS = 350;
const ANSI_RESET = "\u001b[0m";
const ANSI_BOLD = "\u001b[1m";
const ANSI_DIM = "\u001b[2m";
const ANSI_RED = "\u001b[31m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_BLUE = "\u001b[34m";
const ANSI_MAGENTA = "\u001b[35m";
const ANSI_CYAN = "\u001b[36m";

interface UnsignedPaymentTransaction {
  kind: "transfer";
  version: "legacy";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator?: string;
}

interface WalletUsdcBalances {
  from: bigint;
  to: bigint;
}

interface AddressSlotSnapshot {
  address: string;
  label: string;
  slot: number;
}

interface AddressBalanceSnapshot {
  address: string;
  label: string;
  usdcBalance: bigint;
}

interface BalanceCheckResult {
  balances: WalletUsdcBalances;
  diff: bigint;
}

function printUsage() {
  console.error("Usage: ppay <amount> <from-keypair.json> <to> <ntimes>");
  console.error("Example: ppay 1 ~/.config/solana/id.json 9xyz... 20");
  console.error("");
  console.error("Optional env:");
  console.error("  PAYMENTS_API_BASE_URL, PAYMENTS_CLUSTER, PAYMENTS_USDC_MINT");
  console.error("  SOLANA_RPC_URL, NEXT_PUBLIC_SOLANA_RPC_URL");
  console.error("  PPAY_MIN_DELAY_MS, PPAY_MAX_DELAY_MS, PPAY_SPLIT, PPAY_MEMO");
}

function getEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getPaymentsApiBaseUrl() {
  return (
    getEnv("PAYMENTS_API_BASE_URL") ??
    getEnv("NEXT_PUBLIC_PAYMENTS_API_BASE_URL") ??
    DEFAULT_PAYMENTS_API_BASE_URL
  ).replace(/\/+$/, "");
}

function getPaymentsCluster() {
  return (
    getEnv("PAYMENTS_CLUSTER") ??
    getEnv("NEXT_PUBLIC_PAYMENTS_CLUSTER") ??
    DEFAULT_PAYMENTS_CLUSTER
  );
}

function getUsdcMint(cluster: string) {
  const configuredMint =
    getEnv("PAYMENTS_USDC_MINT") ??
    getEnv("NEXT_PUBLIC_PAYMENTS_TEST_USDC_MINT");

  if (configuredMint) return configuredMint;
  if (cluster === "devnet") return DEFAULT_DEVNET_USDC_MINT; // Devnet USDC mint
  return DEFAULT_MAINNET_USDC_MINT;
}

function getRpcEndpoint(cluster: string) {
  return (
    getEnv("SOLANA_RPC_URL") ??
    getEnv("NEXT_PUBLIC_SOLANA_RPC_URL") ??
    (cluster === "devnet"
      ? DEFAULT_DEVNET_RPC_ENDPOINT
      : DEFAULT_MAINNET_RPC_ENDPOINT)
  );
}

function parsePositiveInteger(value: string, fieldName: string) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return Number.parseInt(value, 10);
}

function parseIntegerEnv(name: string, fallback: number, min: number, max: number) {
  const value = getEnv(name);
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer`);
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }

  return parsed;
}

function decimalAmountToBaseUnits(value: string, decimals: number) {
  if (!/^\d*\.?\d+$/.test(value)) {
    throw new Error("amount must be a positive decimal number");
  }

  const [wholePart, fractionPart = ""] = value.split(".");
  if (fractionPart.length > decimals) {
    throw new Error(`amount supports at most ${decimals} decimal places`);
  }

  const normalizedWholePart = wholePart || "0";
  const normalizedFractionPart = fractionPart.padEnd(decimals, "0");
  const combined = `${normalizedWholePart}${normalizedFractionPart}`.replace(
    /^0+(?=\d)/,
    ""
  );

  if (!/^[1-9]\d*$/.test(combined || "0")) {
    throw new Error("amount must be greater than zero");
  }

  return combined;
}

function formatBaseUnits(amount: bigint, decimals: number) {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 10n ** BigInt(decimals);
  const fraction = (absolute % 10n ** BigInt(decimals))
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const formatted = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${formatted}` : formatted;
}

function colorize(value: string, color: string) {
  return `${color}${value}${ANSI_RESET}`;
}

function bold(value: string) {
  return colorize(value, ANSI_BOLD);
}

function boldRed(value: string) {
  return `${ANSI_BOLD}${ANSI_RED}${value}${ANSI_RESET}`;
}

function dim(value: string) {
  return colorize(value, ANSI_DIM);
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

function shortenAddress(value: string) {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getExportBaseName(snapshot: { label: string }) {
  return snapshot.label;
}

function getNextRunDirectoryName(storeDir: string, slotSnapshots: AddressSlotSnapshot[]) {
  mkdirSync(storeDir, { recursive: true });

  const nextIndex =
    readdirSync(storeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const match = entry.name.match(/^(\d+)\./);
        return match ? Number.parseInt(match[1], 10) : 0;
      })
      .reduce((max, value) => Math.max(max, value), 0) + 1;

  const slotSuffix = slotSnapshots.map((snapshot) => snapshot.slot).join("_");
  return `${nextIndex}.${slotSuffix}`;
}

function expandHome(filePath: string) {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function parseSecretKey(raw: string, fieldName: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      return bs58.decode(raw.trim());
    } catch {
      throw new Error(
        `${fieldName} must be a JSON byte array, JSON base58 string, or raw base58 string`
      );
    }
  }

  if (typeof parsed === "string") {
    try {
      return bs58.decode(parsed.trim());
    } catch {
      throw new Error(`${fieldName} must contain a valid base58 secret key`);
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      `${fieldName} must be a JSON array of secret-key bytes or a base58 string`
    );
  }

  if (parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error(`${fieldName} contains invalid secret-key bytes`);
  }

  return Uint8Array.from(parsed);
}

function loadKeypairFromFile(filePath: string) {
  const absolutePath = path.resolve(expandHome(filePath));
  const fileContents = readFileSync(absolutePath, "utf8");

  return Keypair.fromSecretKey(parseSecretKey(fileContents, absolutePath));
}

function parsePublicKey(value: string, fieldName: string) {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${fieldName} is not a valid Solana public key`);
  }
}

async function getLatestAddressSlot(connection: Connection, address: PublicKey) {
  const [latest] = await withRpcRetry(
    () => connection.getSignaturesForAddress(address, { limit: 1 }, "confirmed"),
    `latest slot for ${shortenAddress(address.toBase58())}`
  );
  return latest?.slot ?? 0;
}

async function withRpcRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  return withNetworkRetry(
    fn,
    ({ attempt, delayMs, message }) => {
      printStatus(
        "RPC  ",
        `${label} failed (${message}). Waiting ${delayMs}ms before retry ${attempt + 1}`,
        ANSI_YELLOW
      );
    },
    (message) => /too many requests|429|fetch failed|timed out|timeout|network/i.test(message)
  );
}

async function collectNewTransactions(
  connection: Connection,
  address: PublicKey,
  baselineSlot: number
) {
  const signatures: Array<{
    blockTime: number | null;
    confirmationStatus?: string;
    err: unknown;
    memo: string | null;
    signature: string;
    slot: number;
  }> = [];
  let before: string | undefined;

  while (true) {
    const page = await withRpcRetry(
      () =>
        connection.getSignaturesForAddress(
          address,
          { before, limit: 100 },
          "confirmed"
        ),
      `signatures for ${shortenAddress(address.toBase58())}`
    );

    if (page.length === 0) break;

    for (const item of page) {
      if (item.slot <= baselineSlot) {
        before = undefined;
        break;
      }

      signatures.push({
        blockTime: item.blockTime,
        confirmationStatus: item.confirmationStatus ?? undefined,
        err: item.err,
        memo: item.memo,
        signature: item.signature,
        slot: item.slot,
      });
    }

    const reachedBaseline = page.some((item) => item.slot <= baselineSlot);
    if (reachedBaseline) break;
    before = page[page.length - 1]?.signature;
    await sleep(EXPORT_PAGE_DELAY_MS);
  }

  const parsedTransactions = [];
  for (const item of signatures) {
    const parsedTransaction = await withRpcRetry(
      () =>
        connection.getParsedTransaction(item.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }),
      `parsed tx ${shortenAddress(item.signature)}`
    );
    parsedTransactions.push(
      {
        ...item,
        transaction: parsedTransaction ?? null,
      }
    );
    await sleep(EXPORT_TX_DELAY_MS);
  }

  return parsedTransactions;
}

function writeTransactionDump(
  outputDir: string,
  snapshot: AddressSlotSnapshot,
  transactions: unknown[]
) {
  const filePath = path.join(outputDir, `${getExportBaseName(snapshot)}_tx.json`);
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        address: snapshot.address,
        baselineSlot: snapshot.slot,
        newTransactionCount: transactions.length,
        transactions,
      },
      null,
      2
    )}\n`
  );
}

function writeBalanceDump(
  outputDir: string,
  snapshot: AddressBalanceSnapshot,
  phase: "before" | "after",
  extra?: Record<string, string | number | boolean>
) {
  const filePath = path.join(outputDir, `${getExportBaseName(snapshot)}_${phase}.json`);
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        address: snapshot.address,
        usdcBalance: formatBaseUnits(snapshot.usdcBalance, USDC_DECIMALS),
        ...(extra ?? {}),
      },
      null,
      2
    )}\n`
  );
}

function writeResultDump(
  outputDir: string,
  result: {
    completedTransfers: number;
    requestedTransfers: number;
    doubleSpendDetected: boolean;
    stoppedEarly: boolean;
    balanceCheck: "matched" | "positive_diff" | "negative_diff";
    balanceDiff: string;
  }
) {
  const filePath = path.join(outputDir, "result.json");
  writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`);
}

async function getWalletMintBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey
) {
  const accounts = await withRpcRetry(
    () => connection.getParsedTokenAccountsByOwner(owner, { mint }, "confirmed"),
    `token balance for ${shortenAddress(owner.toBase58())}`
  );

  return accounts.value.reduce((total, account) => {
    const amount =
      account.account.data.parsed.info.tokenAmount.amount as string | undefined;
    return total + BigInt(amount ?? "0");
  }, 0n);
}

async function getWalletUsdcBalances(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  usdcMint: PublicKey
): Promise<WalletUsdcBalances> {
  const [fromBalance, toBalance] = await Promise.all([
    getWalletMintBalance(connection, from, usdcMint),
    getWalletMintBalance(connection, to, usdcMint),
  ]);

  return { from: fromBalance, to: toBalance };
}

async function getAddressBalanceSnapshots(
  connection: Connection,
  snapshots: AddressSlotSnapshot[],
  usdcMint: PublicKey
): Promise<AddressBalanceSnapshot[]> {
  const balances = await Promise.all(
    snapshots.map(async (snapshot) => ({
      address: snapshot.address,
      label: snapshot.label,
      usdcBalance: await getWalletMintBalance(
        connection,
        new PublicKey(snapshot.address),
        usdcMint
      ),
    }))
  );

  return balances;
}

function getBalanceDiff(before: WalletUsdcBalances, after: WalletUsdcBalances) {
  return after.from + after.to - (before.from + before.to);
}

async function getBalanceCheckResult(
  connection: Connection,
  before: WalletUsdcBalances,
  from: PublicKey,
  to: PublicKey,
  usdcMint: PublicKey
): Promise<BalanceCheckResult> {
  const balances = await getWalletUsdcBalances(connection, from, to, usdcMint);
  return {
    balances,
    diff: getBalanceDiff(before, balances),
  };
}

function logWalletUsdcBalances(label: string, balances: WalletUsdcBalances) {
  printSection(`${label} Balances`, ANSI_MAGENTA);
  printKeyValue(
    "From",
    `${colorize(formatBaseUnits(balances.from, USDC_DECIMALS), ANSI_GREEN)} USDC`
  );
  printKeyValue(
    "To",
    `${colorize(formatBaseUnits(balances.to, USDC_DECIMALS), ANSI_GREEN)} USDC`
  );
  printKeyValue(
    "Sum",
    `${bold(formatBaseUnits(balances.from + balances.to, USDC_DECIMALS))} USDC`
  );
}

async function buildUnsignedTransfer(input: {
  amountBaseUnits: string;
  from: string;
  maxDelayMs: number;
  memo?: string;
  minDelayMs: number;
  split: number;
  to: string;
  usdcMint: string;
}) {
  const response = await fetch(`${getPaymentsApiBaseUrl()}/v1/spl/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      cluster: getPaymentsCluster(),
      mint: input.usdcMint,
      amount: Number(BigInt(input.amountBaseUnits)),
      visibility: "private",
      fromBalance: "base",
      toBalance: "base",
      initIfMissing: true,
      initAtasIfMissing: true,
      initVaultIfMissing: true,
      minDelayMs: String(input.minDelayMs),
      maxDelayMs: String(input.maxDelayMs),
      split: input.split,
      ...(input.memo ? { memo: input.memo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMessage =
      responseBody?.error?.message ??
      responseBody?.message ??
      `Payments API error: ${response.status}`;
    throw new Error(errorMessage);
  }

  return responseBody as UnsignedPaymentTransaction;
}

async function main() {
  const [, , amountArg, fromArg, toArg, ntimesArg] = process.argv;
  if (!amountArg || !fromArg || !toArg || !ntimesArg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const signer = loadKeypairFromFile(fromArg);
  const to = parsePublicKey(toArg, "to");
  const ntimes = parsePositiveInteger(ntimesArg, "ntimes");
  const amountBaseUnits = decimalAmountToBaseUnits(amountArg, USDC_DECIMALS);
  const minDelayMs = parseIntegerEnv("PPAY_MIN_DELAY_MS", 0, 0, MAX_PRIVATE_DELAY_MS);
  const maxDelayMs = parseIntegerEnv(
    "PPAY_MAX_DELAY_MS",
    minDelayMs,
    minDelayMs,
    MAX_PRIVATE_DELAY_MS
  );
  const split = parseIntegerEnv("PPAY_SPLIT", 1, 1, 10);
  const memo = getEnv("PPAY_MEMO");
  const signerAddress = signer.publicKey.toBase58();
  const toAddress = to.toBase58();
  const cluster = getPaymentsCluster();
  const usdcMintKey = parsePublicKey(getUsdcMint(cluster), "USDC mint");
  const usdcMint = usdcMintKey.toBase58();
  const rpcEndpoint = getRpcEndpoint(cluster);
  const connection = new Connection(rpcEndpoint, "confirmed");
  const fromKey = signer.publicKey;
  const vaultKey = parsePublicKey(DEVNET_VAULT, "vault");

  printSection("Private USDC Transfer", ANSI_CYAN);
  printKeyValue("Amount", `${bold(amountArg)} USDC x ${bold(String(ntimes))}`);
  printKeyValue("Cluster", colorize(cluster, ANSI_YELLOW));
  printKeyValue("From", `${shortenAddress(signerAddress)} ${dim(signerAddress)}`);
  printKeyValue("To", `${shortenAddress(toAddress)} ${dim(toAddress)}`);
  printKeyValue("USDC Mint", `${shortenAddress(usdcMint)} ${dim(usdcMint)}`);
  printKeyValue("RPC", dim(rpcEndpoint));
  printKeyValue(
    "Routing",
    `min=${colorize(String(minDelayMs), ANSI_YELLOW)} max=${colorize(
      String(maxDelayMs),
      ANSI_YELLOW
    )} split=${colorize(String(split), ANSI_YELLOW)}`
  );

  const slotSnapshots: AddressSlotSnapshot[] = [
    {
      label: "from",
      address: signerAddress,
      slot: await getLatestAddressSlot(connection, fromKey),
    },
    {
      label: "to",
      address: toAddress,
      slot: await getLatestAddressSlot(connection, to),
    },
    {
      label: "vault",
      address: vaultKey.toBase58(),
      slot: await getLatestAddressSlot(connection, vaultKey),
    },
  ];
  printSection("Slot Snapshot", ANSI_YELLOW);
  slotSnapshots.forEach((snapshot) => {
    printKeyValue(snapshot.label, colorize(String(snapshot.slot), ANSI_YELLOW));
  });

  const balancesBefore = await getWalletUsdcBalances(
    connection,
    fromKey,
    to,
    usdcMintKey
  );
  const addressBalancesBefore = await getAddressBalanceSnapshots(
    connection,
    slotSnapshots,
    usdcMintKey
  );
  logWalletUsdcBalances("Before", balancesBefore);

  const signatures: string[] = [];
  let completedTransfers = 0;
  let doubleSpendDetected = false;

  for (let index = 0; index < ntimes; index += 1) {
    const current = index + 1;
    let attempt = 1;

    while (true) {
      try {
        printSection(`Transfer ${current}/${ntimes}`, ANSI_BLUE);
        printStatus(
          "BUILD",
          `Creating private transfer for ${amountArg} USDC ${dim(`(attempt ${attempt})`)}`,
          ANSI_BLUE
        );

        const unsignedTransaction = await buildUnsignedTransfer({
          amountBaseUnits,
          from: signerAddress,
          to: toAddress,
          usdcMint,
          minDelayMs,
          maxDelayMs,
          split,
          ...(memo ? { memo } : {}),
        });

        if (unsignedTransaction.version !== "legacy") {
          throw new Error(
            `Unsupported transaction version: ${unsignedTransaction.version}`
          );
        }

        if (!unsignedTransaction.requiredSigners.includes(signerAddress)) {
          throw new Error("Signer is not listed as a required signer");
        }

        const transaction = Transaction.from(
          Buffer.from(unsignedTransaction.transactionBase64, "base64")
        );
        transaction.sign(signer);

        printStatus("SEND ", "Submitting signed transaction", ANSI_YELLOW);
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: true,
          maxRetries: 10,
        });

        const confirmation = await connection.confirmTransaction(
          {
            signature,
            blockhash: unsignedTransaction.recentBlockhash,
            lastValidBlockHeight: unsignedTransaction.lastValidBlockHeight,
          },
          "confirmed"
        );

        if (confirmation.value.err) {
          throw new Error(
            `Transaction ${signature} failed on-chain: ${JSON.stringify(
              confirmation.value.err
            )}`
          );
        }

        signatures.push(signature);
        completedTransfers += 1;
        printStatus(
          "OK   ",
          `${shortenAddress(signature)} ${dim(signature)}`,
          ANSI_GREEN
        );
        break;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        printStatus("ERR  ", message, ANSI_RED);
        const retryDelayMs = getBackoffDelayMs(attempt);
        printStatus(
          "RETRY",
          `Waiting ${retryDelayMs}ms before retrying transfer ${current}/${ntimes} (attempt ${attempt + 1})`,
          ANSI_MAGENTA
        );
        await sleep(retryDelayMs);
        attempt += 1;
      }
    }

    if (
      completedTransfers > 0 &&
      completedTransfers % CHECKPOINT_INTERVAL === 0 &&
      current < ntimes
    ) {
      printSection(`Checkpoint ${completedTransfers}`, ANSI_CYAN);
      printStatus(
        "WAIT ",
        `Completed ${completedTransfers} transfers. Waiting ${CHECKPOINT_DELAY_MS}ms before balance check`,
        ANSI_YELLOW
      );
      await sleep(CHECKPOINT_DELAY_MS);

      const checkpointResult = await getBalanceCheckResult(
        connection,
        balancesBefore,
        fromKey,
        to,
        usdcMintKey
      );

      logWalletUsdcBalances(`Checkpoint ${completedTransfers}`, checkpointResult.balances);
      if (checkpointResult.diff > 0n) {
        console.log(
          boldRed(
            `DOUBLE-SPEND DETECTED: positive diff ${formatBaseUnits(
              checkpointResult.diff,
              USDC_DECIMALS
            )} USDC after ${completedTransfers} transfers`
          )
        );
        doubleSpendDetected = true;
        break;
      }

      if (checkpointResult.diff === 0n) {
        printStatus("CHK  ", "Balance check matched. Continuing.", ANSI_GREEN);
      } else {
        printStatus(
          "CHK  ",
          `Balance mismatch ${formatBaseUnits(checkpointResult.diff, USDC_DECIMALS)} USDC. Continuing.`,
          ANSI_YELLOW
        );
      }
    }

    if (current < ntimes) {
      printStatus("PAUSE", `${TRANSFER_DELAY_MS}ms before next transfer`, ANSI_MAGENTA);
      await sleep(TRANSFER_DELAY_MS);
    }
  }

  const balancesAfter = await getWalletUsdcBalances(
    connection,
    fromKey,
    to,
    usdcMintKey
  );
  let finalBalancesAfter = balancesAfter;
  let balanceDiff = getBalanceDiff(balancesBefore, finalBalancesAfter);

  if (balanceDiff < 0n) {
    printSection("Balance Settle", ANSI_YELLOW);
    printStatus(
      "WAIT ",
      `Negative diff detected. Retrying for up to ${(
        (BALANCE_SETTLE_ATTEMPTS - 1) *
        BALANCE_SETTLE_DELAY_MS
      ) / 1000}s`,
      ANSI_YELLOW
    );

    for (let attempt = 2; attempt <= BALANCE_SETTLE_ATTEMPTS; attempt += 1) {
      await sleep(BALANCE_SETTLE_DELAY_MS);
      finalBalancesAfter = await getWalletUsdcBalances(
        connection,
        fromKey,
        to,
        usdcMintKey
      );
      balanceDiff = getBalanceDiff(balancesBefore, finalBalancesAfter);
      if (balanceDiff >= 0n) break;

      printStatus(
        "WAIT ",
        `Attempt ${attempt}/${BALANCE_SETTLE_ATTEMPTS}: diff ${formatBaseUnits(
          balanceDiff,
          USDC_DECIMALS
        )} USDC`,
        ANSI_YELLOW
      );
    }
  }

  logWalletUsdcBalances("After", finalBalancesAfter);
  const addressBalancesAfter = await getAddressBalanceSnapshots(
    connection,
    slotSnapshots,
    usdcMintKey
  );

  printSection("Balance Check", ANSI_CYAN);
  if (balanceDiff === 0n) {
    console.log(
      `${colorize("MATCH", ANSI_GREEN)} ${bold("Combined balance is unchanged.")}`
    );
  } else {
    console.log(
      `${colorize("DIFF ", ANSI_RED)} ${bold(formatBaseUnits(
        balanceDiff,
        USDC_DECIMALS
      ))} USDC`
    );
  }

  printSection("Done", ANSI_GREEN);
  console.log(`${colorize("TXS  ", ANSI_GREEN)} ${signatures.length} confirmed`);
  signatures.forEach((signature, index) => {
    console.log(`  ${dim(String(index + 1).padStart(2, "0"))} ${signature}`);
  });

  const storeDir = path.join(process.cwd(), STORE_DIR);
  const runDirectoryName = getNextRunDirectoryName(storeDir, slotSnapshots);
  const outputDir = path.join(storeDir, runDirectoryName);
  mkdirSync(outputDir, { recursive: true });

  printSection("Transaction Export", ANSI_CYAN);
  printKeyValue("Store", dim(outputDir));
  printStatus(
    "WAIT ",
    `Letting RPC/indexer settle for ${EXPORT_SETTLE_DELAY_MS}ms before export`,
    ANSI_YELLOW
  );
  await sleep(EXPORT_SETTLE_DELAY_MS);
  addressBalancesBefore.forEach((snapshot) => {
    writeBalanceDump(outputDir, snapshot, "before");
  });
  const commonNewTxCount = signatures.length;
  addressBalancesAfter.forEach((snapshot) => {
    const beforeBalance = addressBalancesBefore.find(
      (item) => item.address === snapshot.address
    )!;
    const balanceChange = snapshot.usdcBalance - beforeBalance.usdcBalance;
    const extra: Record<string, string | number | boolean> = {
      commonNewTxCount,
      balanceChange: formatBaseUnits(balanceChange, USDC_DECIMALS),
    };

    if (snapshot.label === "from") {
      extra.transfersCompleted = completedTransfers;
      extra.doubleSpendDetected = doubleSpendDetected;
    }

    if (snapshot.label === "to") {
      extra.usdcIncrease = formatBaseUnits(balanceChange, USDC_DECIMALS);
    }

    if (snapshot.label === "vault") {
      extra.vaultBalanceChange = formatBaseUnits(balanceChange, USDC_DECIMALS);
    }

    writeBalanceDump(outputDir, snapshot, "after", extra);
  });
  for (const snapshot of slotSnapshots) {
    const addressKey = new PublicKey(snapshot.address);
    const transactions = await collectNewTransactions(
      connection,
      addressKey,
      snapshot.slot
    );
    writeTransactionDump(outputDir, snapshot, transactions);
    const beforeBalance = addressBalancesBefore.find(
      (item) => item.address === snapshot.address
    )!;
    const afterBalance = addressBalancesAfter.find(
      (item) => item.address === snapshot.address
    )!;
    printKeyValue(
      snapshot.label,
      `${transactions.length} new tx ${dim(
        path.join(outputDir, `${getExportBaseName(snapshot)}_tx.json`)
      )}`
    );
    printKeyValue(
      `${snapshot.label} bal`,
      `${formatBaseUnits(beforeBalance.usdcBalance, USDC_DECIMALS)} -> ${formatBaseUnits(
        afterBalance.usdcBalance,
        USDC_DECIMALS
      )} USDC`
    );
  }

  writeResultDump(outputDir, {
    completedTransfers,
    requestedTransfers: ntimes,
    doubleSpendDetected,
    stoppedEarly: doubleSpendDetected && completedTransfers < ntimes,
    balanceCheck:
      balanceDiff === 0n ? "matched" : balanceDiff > 0n ? "positive_diff" : "negative_diff",
    balanceDiff: formatBaseUnits(balanceDiff, USDC_DECIMALS),
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
