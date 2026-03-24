import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  AGGREGATOR_ENDPOINTS,
  getAggregatorHeaders,
  getAggregatorTimeoutSignal,
  getAggregatorUrl,
} from "@/lib/aggregator";

/**
 * Proxy to an aggregator-compatible swap API – build a swap transaction
 * https://dev.jup.ag/docs/swap-api/build-swap-transaction
 *
 * POST body: { quoteResponse, userPublicKey, dynamicComputeUnitLimit?, prioritizationFeeLamports? }
 * Returns: { swapTransaction (base64), lastValidBlockHeight, prioritizationFeeLamports, dynamicSlippageReport? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { quoteResponse, userPublicKey } = body;

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

    const res = await fetch(getAggregatorUrl(AGGREGATOR_ENDPOINTS.swap), {
      method: "POST",
      headers: getAggregatorHeaders("application/json"),
      body: JSON.stringify({
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
      }),
      signal: getAggregatorTimeoutSignal(),
      cache: "no-store",
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Aggregator swap build error:", res.status, errorText);
      return NextResponse.json(
        { error: `Aggregator swap error: ${res.status}`, details: errorText },
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
