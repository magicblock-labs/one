import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  PAYMENTS_CLUSTER,
  PAYMENTS_ENDPOINTS,
  getPaymentsApiUrl,
  getPaymentsTimeoutSignal,
} from "@/lib/payments";
import { getPaymentsErrorMessage } from "@/lib/payments-errors";

interface ShieldBuildRequest {
  mode?: "shield" | "unshield";
  owner?: string;
  mint?: string;
  amount?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ShieldBuildRequest;
    const { mode, owner, mint, amount } = body;

    if (
      (mode !== "shield" && mode !== "unshield") ||
      typeof owner !== "string" ||
      typeof mint !== "string" ||
      typeof amount !== "string"
    ) {
      return NextResponse.json(
        { error: "Missing or invalid shield parameters" },
        { status: 400 }
      );
    }

    try {
      new PublicKey(owner);
      new PublicKey(mint);
    } catch {
      return NextResponse.json(
        { error: "Invalid owner or mint public key" },
        { status: 400 }
      );
    }

    if (!/^[1-9]\d*$/.test(amount)) {
      return NextResponse.json(
        { error: "amount must be a positive integer string" },
        { status: 400 }
      );
    }

    const amountBigInt = BigInt(amount);
    if (amountBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      return NextResponse.json(
        { error: "amount exceeds the maximum supported integer size" },
        { status: 400 }
      );
    }

    const endpoint =
      mode === "shield"
        ? PAYMENTS_ENDPOINTS.deposit
        : PAYMENTS_ENDPOINTS.withdraw;

    const upstreamRes = await fetch(getPaymentsApiUrl(endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner,
        ...(PAYMENTS_CLUSTER ? { cluster: PAYMENTS_CLUSTER } : {}),
        mint,
        amount: Number(amountBigInt),
        initIfMissing: true,
        initAtasIfMissing: true,
        ...(mode === "shield" ? { initVaultIfMissing: true } : {}),
        idempotent: true,
      }),
      signal: getPaymentsTimeoutSignal(),
      cache: "no-store",
    });

    const responseBody = await upstreamRes.json().catch(() => null);
    if (!upstreamRes.ok) {
      return NextResponse.json(
        {
          error: getPaymentsErrorMessage(upstreamRes.status, responseBody),
          details: responseBody,
        },
        { status: upstreamRes.status }
      );
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("Payments shield build error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build shield transaction",
      },
      { status: 500 }
    );
  }
}
