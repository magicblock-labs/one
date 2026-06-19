import { Transaction, VersionedTransaction } from "@solana/web3.js";

export interface UnsignedPaymentTransaction {
  kind: string;
  version?: "legacy" | "v0" | 0 | "0";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator?: string;
}

export interface TransferQueueEnsureCrankResponse {
  mint: string;
  validator: string;
  transferQueue: string;
  crankSignature: string;
}

interface PaymentTransactionSubmissionErrorOptions {
  status: number;
  signature?: string;
  details?: string;
}

export class PaymentTransactionSubmissionError extends Error {
  status: number;
  signature?: string;
  details?: string;

  constructor(
    message: string,
    { status, signature, details }: PaymentTransactionSubmissionErrorOptions
  ) {
    const signatureSuffix = signature ? ` (tx: ${signature})` : "";
    const detailsSuffix = details ? `: ${details}` : "";
    super(`${message}${signatureSuffix}${detailsSuffix}`);
    this.name = "PaymentTransactionSubmissionError";
    this.status = status;
    this.signature = signature;
    this.details = details;
  }
}

export function isPaymentBlockhashExpiredError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const details =
    error instanceof PaymentTransactionSubmissionError && error.details
      ? error.details
      : "";
  const normalized = `${message} ${details}`.toLowerCase();

  return (
    normalized.includes("block height exceeded") ||
    normalized.includes("blockhash expired") ||
    normalized.includes("blockhash not found") ||
    normalized.includes("transaction expired")
  );
}

function base64ToUint8Array(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.btoa(binary);
}

export function deserializeUnsignedPaymentTransaction(
  unsignedTransaction: UnsignedPaymentTransaction
) {
  const transactionBytes = base64ToUint8Array(
    unsignedTransaction.transactionBase64
  );

  if (
    unsignedTransaction.version === undefined ||
    unsignedTransaction.version === null
  ) {
    try {
      return Transaction.from(transactionBytes);
    } catch {
      return VersionedTransaction.deserialize(transactionBytes);
    }
  }

  if (unsignedTransaction.version === "legacy") {
    return Transaction.from(transactionBytes);
  }

  if (
    unsignedTransaction.version === "v0" ||
    unsignedTransaction.version === 0 ||
    unsignedTransaction.version === "0"
  ) {
    return VersionedTransaction.deserialize(transactionBytes);
  }

  throw new Error(
    `Unsupported transaction version: ${unsignedTransaction.version}`
  );
}

export function serializeSignedPaymentTransaction(
  transaction: Transaction | VersionedTransaction
) {
  return uint8ArrayToBase64(transaction.serialize());
}

export async function submitSignedPaymentTransaction(
  unsignedTransaction: UnsignedPaymentTransaction,
  signedTransaction: Transaction | VersionedTransaction,
  authToken?: string | null
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch("/api/payments/send", {
    method: "POST",
    headers,
    body: JSON.stringify({
      signedTransaction: serializeSignedPaymentTransaction(signedTransaction),
      blockhash: unsignedTransaction.recentBlockhash,
      lastValidBlockHeight: unsignedTransaction.lastValidBlockHeight,
      sendTo: unsignedTransaction.sendTo,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new PaymentTransactionSubmissionError(
      body?.error || `Transaction submission failed: ${res.status}`,
      {
        status: res.status,
        signature:
          typeof body?.signature === "string" ? body.signature : undefined,
        details: typeof body?.details === "string" ? body.details : undefined,
      }
    );
  }

  if (typeof body?.signature !== "string") {
    throw new Error("Transaction submission did not return a signature");
  }

  return body.signature as string;
}

export async function ensurePaymentTransferQueueCrank({
  mint,
  validator,
}: {
  mint: string;
  validator?: string | null;
}) {
  const res = await fetch("/api/payments/transfer-queue/ensure-crank", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mint,
      ...(validator ? { validator } : {}),
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error || `Transfer queue crank failed: ${res.status}`
    );
  }

  if (typeof body?.crankSignature !== "string") {
    throw new Error("Transfer queue crank did not return a signature");
  }

  return body as TransferQueueEnsureCrankResponse;
}
