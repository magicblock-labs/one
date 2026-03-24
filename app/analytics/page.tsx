import { Header } from "@/components/one/header";
import { TrendingTokens } from "@/components/one/trending-tokens";
import { PersonalStats } from "@/components/one/personal-stats";

export default function AnalyticsPage() {
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
        <div className="flex flex-col items-center px-4 pt-12 pb-16">
          {/* Hero */}
          <h1 className="text-4xl md:text-5xl font-bold text-foreground text-center leading-none tracking-tight mb-3">
            Analytics
          </h1>
          <p className="text-lg text-muted-foreground text-center mb-10">
            Payment volume and token distribution
          </p>

          {/* Personal Stats - Referral Earnings & Volume */}
          <PersonalStats />

          {/* Global Analytics Content */}
          <TrendingTokens />
        </div>
      </main>
    </div>
  );
}
