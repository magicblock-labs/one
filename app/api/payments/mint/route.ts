import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  PAYMENTS_CLUSTER,
  PAYMENTS_ENDPOINTS,
  getPaymentsApiUrl,
  getPaymentsTimeoutSignal,
} from "@/lib/payments";

interface InitializeMintRequest {
  payer?: string;
  mint?: string;
  validator?: string;
}

function getPaymentsErrorMessage(responseBody: unknown, status: number) {
  if (responseBody && typeof responseBody === "object") {
    const maybeError = "error" in responseBody ? responseBody.error : undefined;
    if (maybeError && typeof maybeError === "object" && "message" in maybeError) {
      const message = maybeError.message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }

    const maybeMessage = "message" in responseBody ? responseBody.message : undefined;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
  }

  return `Payments API error: ${status}`;
}

export async function GET(request: NextRequest) {
  try {
    const mint = request.nextUrl.searchParams.get("mint")?.trim();
    const validator = request.nextUrl.searchParams.get("validator")?.trim();

    if (!mint) {
      return NextResponse.json(
        { error: "Missing mint public key" },
        { status: 400 }
      );
    }

    try {
      new PublicKey(mint);
      if (validator) {
        new PublicKey(validator);
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid mint or validator public key" },
        { status: 400 }
      );
    }

    const upstreamUrl = new URL(getPaymentsApiUrl(PAYMENTS_ENDPOINTS.isMintInitialized));
    upstreamUrl.searchParams.set("mint", mint);
    if (PAYMENTS_CLUSTER) {
      upstreamUrl.searchParams.set("cluster", PAYMENTS_CLUSTER);
    }
    if (validator) {
      upstreamUrl.searchParams.set("validator", validator);
    }

    const upstreamRes = await fetch(upstreamUrl, {
      method: "GET",
      signal: getPaymentsTimeoutSignal(),
      cache: "no-store",
    });

    const responseBody = await upstreamRes.json().catch(() => null);
    if (!upstreamRes.ok) {
      return NextResponse.json(
        {
          error: getPaymentsErrorMessage(responseBody, upstreamRes.status),
          details: responseBody,
        },
        { status: upstreamRes.status }
      );
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("Payments mint status error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch mint initialization status",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as InitializeMintRequest;
    const { payer, mint, validator } = body;

    if (
      typeof payer !== "string" ||
      typeof mint !== "string" ||
      (validator !== undefined && typeof validator !== "string")
    ) {
      return NextResponse.json(
        { error: "Missing or invalid initialize mint parameters" },
        { status: 400 }
      );
    }

    try {
      new PublicKey(payer);
      new PublicKey(mint);
      if (validator) {
        new PublicKey(validator);
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid payer, mint, or validator public key" },
        { status: 400 }
      );
    }

    const upstreamRes = await fetch(getPaymentsApiUrl(PAYMENTS_ENDPOINTS.initializeMint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payer,
        mint,
        ...(PAYMENTS_CLUSTER ? { cluster: PAYMENTS_CLUSTER } : {}),
        ...(validator ? { validator } : {}),
      }),
      signal: getPaymentsTimeoutSignal(),
      cache: "no-store",
    });

    const responseBody = await upstreamRes.json().catch(() => null);
    if (!upstreamRes.ok) {
      return NextResponse.json(
        {
          error: getPaymentsErrorMessage(responseBody, upstreamRes.status),
          details: responseBody,
        },
        { status: upstreamRes.status }
      );
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("Payments initialize mint error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build initialize mint transaction",
      },
      { status: 500 }
    );
  }
}
