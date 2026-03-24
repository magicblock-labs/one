import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src")?.trim();
  if (!src) {
    return NextResponse.json({ error: "Missing src parameter" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return NextResponse.json({ error: "Invalid src URL" }, { status: 400 });
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return NextResponse.json(
      { error: "Unsupported src protocol" },
      { status: 400 }
    );
  }

  const upstreamRes = await fetch(url.toString(), {
    cache: "force-cache",
    next: { revalidate: 86_400 },
  });

  if (!upstreamRes.ok) {
    return NextResponse.json(
      { error: `Failed to fetch token logo: ${upstreamRes.status}` },
      { status: upstreamRes.status }
    );
  }

  const contentType =
    upstreamRes.headers.get("content-type") ?? "application/octet-stream";
  const body = await upstreamRes.arrayBuffer();

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
