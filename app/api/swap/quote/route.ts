import { NextRequest, NextResponse } from "next/server";
import {
  PAYMENTS_ENDPOINTS,
  getPaymentsApiUrl,
  getPaymentsTimeoutSignal,
} from "@/lib/payments";

/**
 * Proxy to the payments swap quote API.
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
    parsedSlippageBps < 0 ||
    parsedSlippageBps > 5000
  ) {
    return NextResponse.json(
      { error: "slippageBps must be between 0 and 5000" },
      { status: 400 }
    );
  }

  try {
    const upstreamUrl = new URL(getPaymentsApiUrl(PAYMENTS_ENDPOINTS.swapQuote));
    upstreamUrl.searchParams.set("inputMint", inputMint);
    upstreamUrl.searchParams.set("outputMint", outputMint);
    upstreamUrl.searchParams.set("amount", amount);
    upstreamUrl.searchParams.set("slippageBps", String(parsedSlippageBps));
    upstreamUrl.searchParams.set("restrictIntermediateTokens", "true");

    const res = await fetch(upstreamUrl, {
      signal: getPaymentsTimeoutSignal(),
      cache: "no-store",
    });

    if (!res.ok) {
      const responseBody = await res.json().catch(() => null);
      const errorMessage =
        responseBody &&
        typeof responseBody === "object" &&
        "error" in responseBody &&
        responseBody.error &&
        typeof responseBody.error === "object" &&
        "message" in responseBody.error &&
        typeof responseBody.error.message === "string"
          ? responseBody.error.message
          : `Payments API error: ${res.status}`;

      return NextResponse.json(
        { error: errorMessage, details: responseBody },
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
