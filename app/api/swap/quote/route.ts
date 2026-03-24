import { NextRequest, NextResponse } from "next/server";
import {
  AGGREGATOR_ENDPOINTS,
  getAggregatorHeaders,
  getAggregatorTimeoutSignal,
  getAggregatorUrl,
} from "@/lib/aggregator";

/**
 * Proxy to an aggregator-compatible quote API
 * https://dev.jup.ag/docs/swap-api/get-quote
 *
 * Query params: inputMint, outputMint, amount (in lamports/smallest unit),
 *               slippageBps (default 50 = 0.5%)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const inputMint = searchParams.get("inputMint");
  const outputMint = searchParams.get("outputMint");
  const amount = searchParams.get("amount");
  const slippageBps = searchParams.get("slippageBps") ?? "50";

  if (!inputMint || !outputMint || !amount) {
    return NextResponse.json(
      { error: "Missing required params: inputMint, outputMint, amount" },
      { status: 400 }
    );
  }

  if (!/^[1-9]\d*$/.test(amount)) {
    return NextResponse.json(
      { error: "amount must be a positive integer string" },
      { status: 400 }
    );
  }

  const parsedSlippageBps = Number(slippageBps);
  if (
    !Number.isFinite(parsedSlippageBps) ||
    parsedSlippageBps <= 0 ||
    parsedSlippageBps > 5000
  ) {
    return NextResponse.json(
      { error: "slippageBps must be between 1 and 5000" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      getAggregatorUrl(AGGREGATOR_ENDPOINTS.swapQuote, {
        inputMint,
        outputMint,
        amount,
        slippageBps: parsedSlippageBps,
        restrictIntermediateTokens: true,
      }),
      {
        headers: getAggregatorHeaders(),
        signal: getAggregatorTimeoutSignal(),
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Aggregator quote error:", res.status, errorText);
      return NextResponse.json(
        { error: `Aggregator quote error: ${res.status}`, details: errorText },
        { status: res.status }
      );
    }

    const quote = await res.json();
    return NextResponse.json(quote);
  } catch (error) {
    console.error("Quote proxy error:", error);
    return NextResponse.json(
      { error: "Failed to fetch quote" },
      { status: 500 }
    );
  }
}
