import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  PAYMENTS_CLUSTER,
  PAYMENTS_ENDPOINTS,
  getPaymentsApiUrl,
  getPaymentsTimeoutSignal,
} from "@/lib/payments";
import {
  getExactStealthHandleInput,
  isStealthHandleInput,
} from "@/lib/stealth-handles";

interface PaymentTransferBuildRequest {
  from?: string;
  to?: string;
  mint?: string;
  amount?: string;
  validator?: string;
  visibility?: "public" | "private";
  fromBalance?: "base" | "ephemeral";
  toBalance?: "base" | "ephemeral";
  authToken?: string;
  gasless?: boolean;
  memo?: string;
  exactOut?: boolean;
  minDelayMs?: string;
  maxDelayMs?: string;
  split?: number;
}

const MAX_PRIVATE_DELAY_MS = BigInt(30 * 60 * 1000);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PaymentTransferBuildRequest;
    const {
      from,
      mint,
      amount,
      validator,
      visibility,
      fromBalance,
      toBalance,
      authToken,
      gasless,
      memo,
      exactOut,
      minDelayMs,
      maxDelayMs,
      split,
    } = body;
    const to = typeof body.to === "string" ? getExactStealthHandleInput(body.to) : "";
    const isStealthRecipient = isStealthHandleInput(to);

    if (
      typeof from !== "string" ||
      !to ||
      typeof mint !== "string" ||
      typeof amount !== "string" ||
      (validator !== undefined && typeof validator !== "string") ||
      (authToken !== undefined && typeof authToken !== "string") ||
      (gasless !== undefined && typeof gasless !== "boolean") ||
      (memo !== undefined && typeof memo !== "string") ||
      (exactOut !== undefined && typeof exactOut !== "boolean") ||
      (minDelayMs !== undefined &&
        (typeof minDelayMs !== "string" || !/^\d+$/.test(minDelayMs))) ||
      (maxDelayMs !== undefined &&
        (typeof maxDelayMs !== "string" || !/^\d+$/.test(maxDelayMs))) ||
      (split !== undefined &&
        (!Number.isInteger(split) || split < 1 || split > 10)) ||
      (fromBalance !== undefined &&
        fromBalance !== "base" &&
        fromBalance !== "ephemeral") ||
      (toBalance !== undefined &&
        toBalance !== "base" &&
        toBalance !== "ephemeral") ||
      (visibility !== undefined &&
        visibility !== "public" &&
        visibility !== "private") ||
      (!isStealthRecipient && visibility === undefined)
    ) {
      return NextResponse.json(
        { error: "Missing or invalid transfer parameters" },
        { status: 400 }
      );
    }

    try {
      new PublicKey(from);
      if (!isStealthRecipient) {
        new PublicKey(to);
      }
      new PublicKey(mint);
      if (validator) {
        new PublicKey(validator);
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid from, to, mint, or validator public key" },
        { status: 400 }
      );
    }

    if (!/^\d+$/.test(amount)) {
      return NextResponse.json(
        { error: "amount must be a non-negative integer string" },
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

    const resolvedVisibility = visibility ?? "private";
    const resolvedFromBalance = fromBalance ?? "base";
    const resolvedToBalance = toBalance ?? "base";

    if (
      isStealthRecipient &&
      (resolvedVisibility !== "private" ||
        resolvedFromBalance !== "base" ||
        resolvedToBalance !== "base")
    ) {
      return NextResponse.json(
        { error: "Stealth handle transfers require private base-to-base routing" },
        { status: 400 }
      );
    }

    if (resolvedToBalance === "ephemeral" && resolvedVisibility !== "private") {
      return NextResponse.json(
        { error: "Shielded balance delivery requires shielded routing" },
        { status: 400 }
      );
    }

    if (resolvedFromBalance === "ephemeral" && !authToken?.trim()) {
      return NextResponse.json(
        { error: "Shielded balance source requires authentication" },
        { status: 400 }
      );
    }

    const upstreamHeaders: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (resolvedFromBalance === "ephemeral") {
      upstreamHeaders.Authorization = `Bearer ${authToken?.trim()}`;
    }

    const upstreamRes = await fetch(getPaymentsApiUrl(PAYMENTS_ENDPOINTS.splTransfer), {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify({
        from,
        to,
        ...(PAYMENTS_CLUSTER ? { cluster: PAYMENTS_CLUSTER } : {}),
        mint,
        amount: Number(amountBigInt),
        ...(validator ? { validator } : {}),
        visibility: resolvedVisibility,
        fromBalance: resolvedFromBalance,
        toBalance: resolvedToBalance,
        initIfMissing: true,
        initAtasIfMissing: true,
        initVaultIfMissing: resolvedToBalance === "ephemeral",
        ...(gasless === true ? { gasless: true } : {}),
        ...(memo ? { memo } : {}),
        ...(exactOut !== undefined ? { exactOut } : {}),
        ...(resolvedVisibility === "private" && minDelayMs !== undefined
          ? { minDelayMs }
          : {}),
        ...(resolvedVisibility === "private" && maxDelayMs !== undefined
          ? { maxDelayMs }
          : {}),
        ...(resolvedVisibility === "private" && split !== undefined ? { split } : {}),
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
