import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SendTransactionError,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createPaymentsEphemeralConnection,
  createServerSolanaConnection,
} from "@/lib/solana-rpc";

function base64ToUint8Array(base64: string) {
  const buffer = Buffer.from(base64, "base64");
  return new Uint8Array(buffer);
}

class FeePayerFundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeePayerFundingError";
  }
}

function getFeePayer(rawTransaction: Uint8Array) {
  try {
    const transaction = Transaction.from(rawTransaction);
    return transaction.feePayer ?? null;
  } catch {
    try {
      const transaction = VersionedTransaction.deserialize(rawTransaction);
      return transaction.message.staticAccountKeys[0] ?? null;
    } catch {
      return null;
    }
  }
}

async function requireFundedBaseFeePayer(
  connection: Connection,
  feePayer: PublicKey | null
) {
  if (!feePayer) {
    return;
  }

  const lamports = await connection.getBalance(feePayer, "confirmed");
  if (lamports > 0) {
    return;
  }

  const feePayerAddress = feePayer.toBase58();
  throw new FeePayerFundingError(
    `Base fee payer ${feePayerAddress} has no SOL on the configured base RPC`
  );
}

async function getSendTransactionLogs(
  error: SendTransactionError,
  connection: Connection
) {
  if (error.logs?.length) {
    return error.logs;
  }

  try {
    return await error.getLogs(connection);
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  let connection: Connection | null = null;

  try {
    const body = await request.json();
    const {
      signedTransaction,
      blockhash,
      lastValidBlockHeight,
      sendTo,
    } = body as {
      signedTransaction?: string;
      blockhash?: string;
      lastValidBlockHeight?: number;
      sendTo?: "base" | "ephemeral";
    };

    if (
      typeof signedTransaction !== "string" ||
      !signedTransaction ||
      typeof blockhash !== "string" ||
      !blockhash ||
      typeof lastValidBlockHeight !== "number" ||
      (sendTo !== "base" && sendTo !== "ephemeral")
    ) {
      return NextResponse.json(
        {
          error:
            "Missing signedTransaction, blockhash, lastValidBlockHeight, or sendTo",
        },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get("authorization") ?? "";
    const authToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (sendTo === "ephemeral" && !authToken) {
      return NextResponse.json(
        { error: "Authentication is required for ephemeral submission" },
        { status: 401 }
      );
    }

    connection =
      sendTo === "ephemeral"
        ? createPaymentsEphemeralConnection(authToken)
        : createServerSolanaConnection();
    const rawTransaction = base64ToUint8Array(signedTransaction);
    if (sendTo === "base") {
      await requireFundedBaseFeePayer(connection, getFeePayer(rawTransaction));
    }

    const signature = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: sendTo === "ephemeral",
      preflightCommitment: "confirmed",
      maxRetries: 10,
    });

    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      "confirmed"
    );

    if (confirmation.value.err) {
      return NextResponse.json(
        {
          error: "Transaction failed on-chain",
          details: JSON.stringify(confirmation.value.err),
          signature,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ signature });
  } catch (error) {
    if (error instanceof FeePayerFundingError) {
      return NextResponse.json(
        {
          error: error.message,
          details:
            "Fund this wallet on the same base RPC used by the Pay server, or point SOLANA_RPC_URL at the chain where the wallet is funded.",
          logs: [],
        },
        { status: 400 }
      );
    }

    if (error instanceof SendTransactionError && connection) {
      const logs = await getSendTransactionLogs(error, connection);
      const transactionError = error.transactionError;
      const message = transactionError.message || error.message;

      console.error("Payments send transaction error:", {
        message,
        logs,
      });

      return NextResponse.json(
        {
          error: message,
          details: logs.length > 0 ? logs.join("\n") : error.message,
          logs,
        },
        { status: 400 }
      );
    }

    console.error("Payments send error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to send transaction",
      },
      { status: 502 }
    );
  }
}
