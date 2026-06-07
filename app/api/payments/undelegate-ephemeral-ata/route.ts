import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  PAYMENTS_CLUSTER,
  PAYMENTS_ENDPOINTS,
  getPaymentsApiUrl,
  getPaymentsTimeoutSignal,
} from "@/lib/payments";
import { getPaymentsErrorMessage } from "@/lib/payments-errors";

interface UndelegateEphemeralAtaRequest {
  payer?: string;
  mint?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UndelegateEphemeralAtaRequest;
    const { payer, mint } = body;
    const authorization = request.headers.get("authorization")?.trim() ?? "";

    if (typeof payer !== "string" || typeof mint !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid undelegate eATA parameters" },
        { status: 400 }
      );
    }

    try {
      new PublicKey(payer);
      new PublicKey(mint);
    } catch {
      return NextResponse.json(
        { error: "Invalid payer or mint public key" },
        { status: 400 }
      );
    }

    const upstreamHeaders: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (authorization) {
      upstreamHeaders.Authorization = authorization;
    }

    const upstreamRes = await fetch(
      getPaymentsApiUrl(PAYMENTS_ENDPOINTS.undelegateEphemeralAta),
      {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify({
          payer,
          mint,
          ...(PAYMENTS_CLUSTER ? { cluster: PAYMENTS_CLUSTER } : {}),
        }),
        signal: getPaymentsTimeoutSignal(),
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
    console.error("Payments undelegate eATA build error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build undelegate eATA transaction",
      },
      { status: 500 }
    );
  }
}
