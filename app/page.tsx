import { Header } from "@/components/one/header";
import { TradeHub } from "@/components/one/trade-hub";
// import { TokenPrices } from "@/components/one/token-prices";
import { NetWorthPanel } from "@/components/one/net-worth-panel";

type HomeProps = {
  searchParams: Promise<{
    buy?: string | string[];
    sell?: string | string[];
    amt?: string | string[];
  }>;
};

function getSearchParamValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function getInitialSwapAmount(value?: string | string[]) {
  const amount = getSearchParamValue(value)?.trim() || "";
  return /^\d*\.?\d*$/.test(amount) ? amount : undefined;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const initialBuyMint = getSearchParamValue(params.buy)?.trim() || undefined;
  const initialSellMint = getSearchParamValue(params.sell)?.trim() || undefined;
  const initialSwapAmount = getInitialSwapAmount(params.amt);

  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      {/* Subtle dot pattern background */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: `radial-gradient(circle, var(--muted-foreground) 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
        }}
      />
      {/* Fade overlay near header */}
      <div 
        className="fixed inset-x-0 top-0 h-44 pointer-events-none z-[1]"
        style={{
          background: `linear-gradient(
            to bottom,
            #131a2a 0%,
            rgba(19, 26, 42, 0.98) 18%,
            rgba(19, 26, 42, 0.9) 38%,
            rgba(19, 26, 42, 0.72) 60%,
            rgba(19, 26, 42, 0.42) 80%,
            rgba(19, 26, 42, 0.14) 94%,
            transparent 100%
          )`,
        }}
      />

      <Header />

      <main className="flex-1 relative z-10">
        <NetWorthPanel />

        <div className="flex flex-col items-center px-4 pt-4 pb-10">
          {/* Subtitle */}
          <p className="text-sm text-muted-foreground mb-4">
            Onchain Payment Made Simple
          </p>

          {/* Swap / Payment Section */}
          <TradeHub
            initialBuyMint={initialBuyMint}
            initialSellMint={initialSellMint}
            initialSwapAmount={initialSwapAmount}
          />

          {/* Token Prices */}
          {/* <TokenPrices /> */}
        </div>
      </main>
    </div>
  );
}
