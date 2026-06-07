import { NextRequest, NextResponse } from "next/server";
import {
  PAYMENTS_CLUSTER,
  PAYMENTS_ENDPOINTS,
  getPaymentsApiUrl,
  getPaymentsTimeoutSignal,
} from "@/lib/payments";
import { getPaymentsErrorMessage } from "@/lib/payments-errors";

interface PaymentTransactionSendRequest {
  transactionBase64?: string;
  sendTo?: "base" | "ephemeral";
  sendRpcEndpoint?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PaymentTransactionSendRequest;
    const {
      transactionBase64,
      sendTo,
      sendRpcEndpoint,
    } = body;
    const authorization = request.headers.get("authorization")?.trim() ?? "";

    if (
      typeof transactionBase64 !== "string" ||
      !transactionBase64.trim() ||
      (sendTo !== "base" && sendTo !== "ephemeral")
    ) {
      return NextResponse.json(
        { error: "Missing or invalid transaction send parameters" },
        { status: 400 }
      );
    }

    if (sendTo === "ephemeral" && !authorization) {
      return NextResponse.json(
        { error: "Shielded transaction submission requires authentication" },
        { status: 400 }
      );
    }

    let resolvedSendRpcEndpoint: string | undefined;
    if (sendRpcEndpoint !== undefined) {
      try {
        const url = new URL(sendRpcEndpoint);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error("Invalid protocol");
        }
        resolvedSendRpcEndpoint = url.toString();
      } catch {
        return NextResponse.json(
          { error: "Invalid send RPC endpoint" },
          { status: 400 }
        );
      }
    }

    const upstreamHeaders: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (authorization) {
      upstreamHeaders.Authorization = authorization;
    }

    if (resolvedSendRpcEndpoint) {
      const rpcRes = await fetch(resolvedSendRpcEndpoint, {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [
            transactionBase64,
            {
              encoding: "base64",
              preflightCommitment: "confirmed",
            },
          ],
        }),
        signal: getPaymentsTimeoutSignal(30_000),
        cache: "no-store",
      });

      const responseBody = await rpcRes.json().catch(() => null);
      if (!rpcRes.ok || responseBody?.error) {
        return NextResponse.json(
          {
            error: responseBody?.error?.message
              ?? responseBody?.error
              ?? `Send failed: ${rpcRes.status}`,
            details: responseBody,
          },
          { status: rpcRes.ok ? 502 : rpcRes.status }
        );
      }

      if (typeof responseBody?.result !== "string") {
        return NextResponse.json(
          {
            error: "Send response did not include a signature",
            details: responseBody,
          },
          { status: 502 }
        );
      }

      return NextResponse.json({
        signature: responseBody.result,
        sendTo,
        confirmed: false,
        confirmationRpcEndpoint: resolvedSendRpcEndpoint,
        confirmationRequiresAuthToken: sendTo === "ephemeral",
      });
    }

    const upstreamRes = await fetch(
      getPaymentsApiUrl(PAYMENTS_ENDPOINTS.transactionSend),
      {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify({
          transactionBase64,
          sendTo,
          ...(PAYMENTS_CLUSTER ? { cluster: PAYMENTS_CLUSTER } : {}),
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
    console.error("Payments transaction send error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to send payment transaction",
      },
      { status: 500 }
    );
  }
}
