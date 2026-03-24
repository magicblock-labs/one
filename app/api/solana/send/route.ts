import { NextRequest, NextResponse } from "next/server";
import { createServerSolanaConnection } from "@/lib/solana-rpc";

function base64ToUint8Array(base64: string) {
  const buffer = Buffer.from(base64, "base64");
  return new Uint8Array(buffer);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      signedTransaction,
      blockhash,
      lastValidBlockHeight,
    } = body as {
      signedTransaction?: string;
      blockhash?: string;
      lastValidBlockHeight?: number;
    };

    if (
      typeof signedTransaction !== "string" ||
      !signedTransaction ||
      typeof blockhash !== "string" ||
      !blockhash ||
      typeof lastValidBlockHeight !== "number"
    ) {
      return NextResponse.json(
        {
          error:
            "Missing signedTransaction, blockhash, or lastValidBlockHeight",
        },
        { status: 400 }
      );
    }

    const connection = createServerSolanaConnection();
    const rawTransaction = base64ToUint8Array(signedTransaction);

    const signature = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 2,
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
    console.error("Solana send error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to send transaction",
      },
      { status: 502 }
    );
  }
}
