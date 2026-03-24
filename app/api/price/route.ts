import { NextRequest, NextResponse } from "next/server";
import {
  AGGREGATOR_ENDPOINTS,
  getAggregatorHeaders,
  getAggregatorTimeoutSignal,
  getAggregatorUrl,
} from "@/lib/aggregator";

interface AggregatorPriceResponseItem {
  usdPrice?: number;
  priceChange24h?: number;
}

const DEFAULT_MINTS = [
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",
  "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
];

export async function GET(request: NextRequest) {
  const mintsParam = request.nextUrl.searchParams.get("mints");

  const mints = Array.from(
    new Set(
      (mintsParam ? mintsParam.split(",") : DEFAULT_MINTS)
        .map((mint) => mint.trim())
        .filter(Boolean)
        .slice(0, 50)
    )
  );

  if (mints.length === 0) {
    return NextResponse.json({});
  }

  try {
    const aggregatorRes = await fetch(
      getAggregatorUrl(AGGREGATOR_ENDPOINTS.price, {
        ids: mints.join(","),
      }),
      {
        headers: getAggregatorHeaders(),
        signal: getAggregatorTimeoutSignal(),
        next: { revalidate: 15 },
      }
    );

    if (!aggregatorRes.ok) {
      const errorText = await aggregatorRes.text();
      console.error("Aggregator price error:", aggregatorRes.status, errorText);
      throw new Error(`Aggregator price error: ${aggregatorRes.status}`);
    }

    const aggregatorData = (await aggregatorRes.json()) as Record<
      string,
      AggregatorPriceResponseItem
    >;

    const prices: Record<string, { usd: number; usd_24h_change: number }> = {};
    for (const mint of mints) {
      const aggregatorPrice = aggregatorData[mint];
      if (!aggregatorPrice) continue;

      prices[mint] = {
        usd: Number(aggregatorPrice.usdPrice) || 0,
        usd_24h_change: Number(aggregatorPrice.priceChange24h) || 0,
      };
    }

    return NextResponse.json(prices, {
      headers: {
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    console.error("Price fetch error:", error);
    return NextResponse.json(
      {
        So11111111111111111111111111111111111111112: {
          usd: 0,
          usd_24h_change: 0,
        },
        EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
          usd: 1,
          usd_24h_change: 0,
        },
      },
      { status: 200 }
    );
  }
}
