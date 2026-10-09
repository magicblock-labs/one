import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = new Set([
  "arweave.net",
  "arweave.dev",
  "www.arweave.net",
  "www.arweave.dev",
  "ipfs.io",
  "www.ipfs.io",
  "cloudflare-ipfs.com",
  "gateway.pinata.cloud",
  "dweb.link",
  "cf-ipfs.com",
]);

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

  if (url.protocol !== "https:") {
    return NextResponse.json(
      { error: "Unsupported src protocol" },
      { status: 400 }
    );
  }

  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
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
