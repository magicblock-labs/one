import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  PAYMENTS_CLUSTER,
  PAYMENTS_ENDPOINTS,
  getPaymentsApiUrl,
  getPaymentsTimeoutSignal,
} from "@/lib/payments";

interface PaymentTransferBuildRequest {
  from?: string;
  to?: string;
  mint?: string;
  amount?: string;
  visibility?: "public" | "private";
  memo?: string;
  minDelayMs?: string;
  maxDelayMs?: string;
  split?: number;
}

const MAX_PRIVATE_DELAY_MS = BigInt(30 * 60 * 1000);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PaymentTransferBuildRequest;
    const { from, to, mint, amount, visibility, memo, minDelayMs, maxDelayMs, split } = body;

    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      typeof mint !== "string" ||
      typeof amount !== "string" ||
      (memo !== undefined && typeof memo !== "string") ||
      (minDelayMs !== undefined &&
        (typeof minDelayMs !== "string" || !/^\d+$/.test(minDelayMs))) ||
      (maxDelayMs !== undefined &&
        (typeof maxDelayMs !== "string" || !/^\d+$/.test(maxDelayMs))) ||
      (split !== undefined &&
        (!Number.isInteger(split) || split < 1 || split > 10)) ||
      (visibility !== "public" && visibility !== "private")
    ) {
      return NextResponse.json(
        { error: "Missing or invalid transfer parameters" },
        { status: 400 }
      );
    }

    try {
      new PublicKey(from);
      new PublicKey(to);
      new PublicKey(mint);
    } catch {
      return NextResponse.json(
        { error: "Invalid from, to, or mint public key" },
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

    if (
      minDelayMs !== undefined &&
      maxDelayMs !== undefined &&
      BigInt(maxDelayMs) < BigInt(minDelayMs)
    ) {
      return NextResponse.json(
        { error: "maxDelayMs must be greater than or equal to minDelayMs" },
        { status: 400 }
      );
    }

    if (
      (minDelayMs !== undefined && BigInt(minDelayMs) > MAX_PRIVATE_DELAY_MS) ||
      (maxDelayMs !== undefined && BigInt(maxDelayMs) > MAX_PRIVATE_DELAY_MS)
    ) {
      return NextResponse.json(
        { error: "minDelayMs and maxDelayMs must be less than or equal to 1800000" },
        { status: 400 }
      );
    }

    const upstreamRes = await fetch(getPaymentsApiUrl(PAYMENTS_ENDPOINTS.splTransfer), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        cluster: PAYMENTS_CLUSTER,
        mint,
        amount: Number(amountBigInt),
        visibility,
        fromBalance: "base",
        toBalance: "base",
        initIfMissing: true,
        initAtasIfMissing: true,
        initVaultIfMissing: true,
        ...(memo ? { memo } : {}),
        ...(visibility === "private" && minDelayMs !== undefined
          ? { minDelayMs }
          : {}),
        ...(visibility === "private" && maxDelayMs !== undefined
          ? { maxDelayMs }
          : {}),
        ...(visibility === "private" && split !== undefined ? { split } : {}),
      }),
      signal: getPaymentsTimeoutSignal(),
      cache: "no-store",
    });

    const responseBody = await upstreamRes.json().catch(() => null);
    if (!upstreamRes.ok) {
      const errorMessage =
        responseBody?.error?.message ||
        responseBody?.message ||
        `Payments API error: ${upstreamRes.status}`;

      return NextResponse.json(
        {
          error: errorMessage,
          details: responseBody,
        },
        { status: upstreamRes.status }
      );
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("Payments transfer build error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build payment transaction",
      },
      { status: 500 }
    );
  }
}
