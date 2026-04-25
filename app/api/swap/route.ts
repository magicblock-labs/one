import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  PAYMENTS_ENDPOINTS,
  getPaymentsApiUrl,
  getPaymentsTimeoutSignal,
} from "@/lib/payments";
import { getPaymentsErrorMessage } from "@/lib/payments-errors";

interface SwapBuildRequest {
  quoteResponse?: unknown;
  userPublicKey?: string;
  visibility?: "public" | "private";
  destination?: string;
  minDelayMs?: string;
  maxDelayMs?: string;
  split?: number;
}

/**
 * Proxy to the payments swap API to build a swap transaction.
 *
 * POST body: {
 *   quoteResponse,
 *   userPublicKey,
 *   dynamicComputeUnitLimit?,
 *   prioritizationFeeLamports?,
 *   visibility?: "public" | "private",
 *   destination?: string,
 *   minDelayMs?: string,
 *   maxDelayMs?: string,
 *   split?: number
 * }
 * Returns: { swapTransaction (base64), lastValidBlockHeight?, prioritizationFeeLamports?, privateTransfer? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SwapBuildRequest;
    const {
      quoteResponse,
      userPublicKey,
      visibility = "public",
      destination,
      minDelayMs,
      maxDelayMs,
      split,
    } = body;

    if (!quoteResponse || typeof userPublicKey !== "string") {
      return NextResponse.json(
        { error: "Missing quoteResponse or userPublicKey" },
        { status: 400 }
      );
    }

    try {
      new PublicKey(userPublicKey);
    } catch {
      return NextResponse.json(
        { error: "Invalid userPublicKey" },
        { status: 400 }
      );
    }

    if (visibility !== "public" && visibility !== "private") {
      return NextResponse.json(
        { error: "Invalid visibility" },
        { status: 400 }
      );
    }

    if (visibility === "private") {
      const hasValidSplit =
        typeof split === "number" &&
        Number.isInteger(split) &&
        split >= 1 &&
        split <= 10;

      if (
        typeof destination !== "string" ||
        typeof minDelayMs !== "string" ||
        !/^\d+$/.test(minDelayMs) ||
        typeof maxDelayMs !== "string" ||
        !/^\d+$/.test(maxDelayMs) ||
        !hasValidSplit
      ) {
        return NextResponse.json(
          {
            error:
              "Private swaps require destination, minDelayMs, maxDelayMs, and split",
          },
          { status: 400 }
        );
      }

      try {
        new PublicKey(destination);
      } catch {
        return NextResponse.json(
          { error: "Invalid destination" },
          { status: 400 }
        );
      }

      if (BigInt(maxDelayMs) < BigInt(minDelayMs)) {
        return NextResponse.json(
          { error: "maxDelayMs must be greater than or equal to minDelayMs" },
          { status: 400 }
        );
      }
    }

    const upstreamBody: Record<string, unknown> = {
      quoteResponse,
      userPublicKey,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: 1_000_000,
          global: false,
          priorityLevel: "high",
        },
      },
    };

    if (visibility === "private") {
      upstreamBody.visibility = "private";
      upstreamBody.destination = destination;
      upstreamBody.minDelayMs = minDelayMs;
      upstreamBody.maxDelayMs = maxDelayMs;
      upstreamBody.split = typeof split === "number" ? split : 1;
    }

    const res = await fetch(getPaymentsApiUrl(PAYMENTS_ENDPOINTS.swap), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstreamBody),
      signal: getPaymentsTimeoutSignal(),
      cache: "no-store",
    });

    if (!res.ok) {
      const responseBody = await res.json().catch(() => null);

      return NextResponse.json(
        {
          error: getPaymentsErrorMessage(res.status, responseBody),
          details: responseBody,
        },
        { status: res.status }
      );
    }

    const swapData = await res.json();
    return NextResponse.json(swapData);
  } catch (error) {
    console.error("Swap proxy error:", error);
    return NextResponse.json(
      { error: "Failed to build swap transaction" },
      { status: 500 }
    );
  }
}
