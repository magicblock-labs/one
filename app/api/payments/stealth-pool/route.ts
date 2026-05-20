import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  PAYMENTS_CLUSTER,
  PAYMENTS_ENDPOINTS,
  getPaymentsApiUrl,
  getPaymentsTimeoutSignal,
} from "@/lib/payments";
import { getPaymentsErrorMessage } from "@/lib/payments-errors";
import {
  STEALTH_POOL_MAX_DESTINATIONS,
  getExactStealthHandleInput,
  isStealthHandleInput,
} from "@/lib/stealth-handles";

interface StealthPoolBuildRequest {
  payer?: string;
  authority?: string;
  handle?: string;
  destinations?: string[];
  splitAcrossKeys?: boolean;
}

export async function GET(request: NextRequest) {
  try {
    const handle = getExactStealthHandleInput(
      request.nextUrl.searchParams.get("handle") ?? ""
    );
    if (!handle || !isStealthHandleInput(handle)) {
      return NextResponse.json(
        { error: "Missing or invalid .block handle" },
        { status: 400 }
      );
    }

    const upstreamUrl = new URL(getPaymentsApiUrl(PAYMENTS_ENDPOINTS.stealthPool));
    upstreamUrl.searchParams.set("handle", handle);
    if (PAYMENTS_CLUSTER) {
      upstreamUrl.searchParams.set("cluster", PAYMENTS_CLUSTER);
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
          error: getPaymentsErrorMessage(upstreamRes.status, responseBody),
          details: responseBody,
        },
        { status: upstreamRes.status }
      );
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("Payments stealth pool status error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch stealth pool status",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing private-session auth token" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as StealthPoolBuildRequest;
    const handle =
      typeof body.handle === "string"
        ? getExactStealthHandleInput(body.handle)
        : "";

    if (
      typeof body.payer !== "string" ||
      typeof body.authority !== "string" ||
      !handle ||
      !isStealthHandleInput(handle) ||
      !Array.isArray(body.destinations) ||
      body.destinations.length < 1 ||
      body.destinations.length > STEALTH_POOL_MAX_DESTINATIONS ||
      (body.splitAcrossKeys !== undefined &&
        typeof body.splitAcrossKeys !== "boolean")
    ) {
      return NextResponse.json(
        { error: "Missing or invalid stealth pool parameters" },
        { status: 400 }
      );
    }

    try {
      new PublicKey(body.payer);
      new PublicKey(body.authority);
      body.destinations.forEach((destination) => new PublicKey(destination));
    } catch {
      return NextResponse.json(
        { error: "Invalid payer, authority, or destination public key" },
        { status: 400 }
      );
    }

    const upstreamRes = await fetch(getPaymentsApiUrl(PAYMENTS_ENDPOINTS.stealthPool), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        payer: body.payer,
        authority: body.authority,
        handle,
        destinations: body.destinations,
        ...(body.splitAcrossKeys !== undefined
          ? { splitAcrossKeys: body.splitAcrossKeys }
          : {}),
        ...(PAYMENTS_CLUSTER ? { cluster: PAYMENTS_CLUSTER } : {}),
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
    console.error("Payments stealth pool build error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build stealth pool transaction",
      },
      { status: 500 }
    );
  }
}
