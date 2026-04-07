import { NextRequest, NextResponse } from "next/server";
import { getPaymentsExplorerTransactionUrl } from "@/lib/payments";

export async function GET(request: NextRequest) {
  const signature = request.nextUrl.searchParams.get("signature")?.trim();

  if (!signature) {
    return NextResponse.json(
      { error: "Missing transaction signature" },
      { status: 400 }
    );
  }

  return NextResponse.redirect(getPaymentsExplorerTransactionUrl(signature));
}
