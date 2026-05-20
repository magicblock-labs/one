import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  PAYMENTS_CLUSTER,
  PAYMENTS_ENDPOINTS,
  getPaymentsApiUrl,
  getPaymentsTimeoutSignal,
} from "@/lib/payments";
import { getPaymentsErrorMessage } from "@/lib/payments-errors";

interface TransferQueueEnsureCrankRequest {
  mint?: string;
  validator?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TransferQueueEnsureCrankRequest;
    const { mint, validator } = body;

    if (
      typeof mint !== "string" ||
      (validator !== undefined && typeof validator !== "string")
    ) {
      return NextResponse.json(
        { error: "Missing or invalid transfer queue crank parameters" },
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

    const upstreamRes = await fetch(
      getPaymentsApiUrl(PAYMENTS_ENDPOINTS.transferQueueEnsureCrank),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint,
          ...(PAYMENTS_CLUSTER ? { cluster: PAYMENTS_CLUSTER } : {}),
          ...(validator ? { validator } : {}),
        }),
        signal: getPaymentsTimeoutSignal(30_000),
        cache: "no-store",
      }
    );

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
    console.error("Payments transfer queue crank error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to ensure transfer queue crank",
      },
      { status: 500 }
    );
  }
}
