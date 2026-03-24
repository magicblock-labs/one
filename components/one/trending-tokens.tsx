"use client";

import { useMemo } from "react";

// Mock payment data - in production this would come from your backend/database
const MOCK_PAYMENT_DATA = [
  { token: "SOL", symbol: "SOL", amount: 1250, color: "#9945FF" },
  { token: "USDC", symbol: "USDC", amount: 3200, color: "#2775CA" },
  { token: "USDT", symbol: "USDT", amount: 890, color: "#26A17B" },
  { token: "BONK", symbol: "BONK", amount: 450, color: "#F7931A" },
  { token: "Other", symbol: "Other", amount: 210, color: "#888888" },
];

export function TrendingTokens() {
  const total = useMemo(
    () => MOCK_PAYMENT_DATA.reduce((sum, d) => sum + d.amount, 0),
    []
  );

  // Calculate pie chart segments
  const segments = useMemo(() => {
    let cumulativePercent = 0;
    return MOCK_PAYMENT_DATA.map((d) => {
      const percent = (d.amount / total) * 100;
      const startPercent = cumulativePercent;
      cumulativePercent += percent;
      return {
        ...d,
        percent,
        startPercent,
        endPercent: cumulativePercent,
      };
    });
  }, [total]);

  // Create SVG arc path for pie chart
  const createArcPath = (startPercent: number, endPercent: number, radius: number) => {
    const startAngle = (startPercent / 100) * 360 - 90;
    const endAngle = (endPercent / 100) * 360 - 90;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    
    const x1 = 50 + radius * Math.cos(startRad);
    const y1 = 50 + radius * Math.sin(startRad);
    const x2 = 50 + radius * Math.cos(endRad);
    const y2 = 50 + radius * Math.sin(endRad);
    
    const largeArc = endPercent - startPercent > 50 ? 1 : 0;
    
    return `M 50 50 L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  return (
    <div className="w-full max-w-[480px] mx-auto mt-8">
      {/* Stats Card */}
      <div className="rounded-2xl bg-[var(--surface-inner)] border border-border/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold text-foreground">Payment Analytics</div>
            <div className="text-xs text-muted-foreground">Tokens sent via MagicBlock</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Total Volume</div>
            <div className="text-sm font-semibold text-foreground font-mono">
              ${total.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Pie Chart */}
          <div className="relative w-28 h-28 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              {segments.map((seg, i) => (
                <path
                  key={seg.token}
                  d={createArcPath(seg.startPercent, seg.endPercent, 40)}
                  fill={seg.color}
                  className="transition-opacity hover:opacity-80"
                />
              ))}
              {/* Inner circle for donut effect */}
              <circle cx="50" cy="50" r="24" fill="var(--surface-container)" />
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-medium text-muted-foreground">
                {segments.length}
              </span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex-1 space-y-2">
            {segments.map((seg) => (
              <div key={seg.token} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="text-xs text-foreground">{seg.symbol}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground font-mono">
                    ${seg.amount.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground w-10 text-right font-mono">
                    {seg.percent.toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
