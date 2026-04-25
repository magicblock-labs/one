"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Send, QrCode } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SwapCard } from "./swap-card";
import { PaymentCard } from "./payment-card";
import { RequestCard } from "./request-card";

const topTabs = [
  { id: "payment", label: "Payment", icon: Send },
  { id: "request", label: "Request", icon: QrCode },
  { id: "swap", label: "Swap", icon: ArrowLeftRight },
] as const;

const SWAP_QUERY_PARAMS = [
  "buy",
  "sell",
  "amt",
  "sprivate",
  "dst",
  "smin",
  "smax",
  "ssplit",
] as const;
const PAYMENT_QUERY_PARAMS = [
  "rcv",
  "mint",
  "memo",
  "public",
  "min",
  "max",
  "split",
] as const;
const REQUEST_QUERY_PARAMS = ["prd", "ramt", "rmint"] as const;

type TopTab = (typeof topTabs)[number]["id"];

interface TradeHubProps {
  initialBuyMint?: string;
  initialSellMint?: string;
  initialSwapAmount?: string;
}

export function TradeHub({
  initialBuyMint,
  initialSellMint,
  initialSwapAmount,
}: TradeHubProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab");
  const hasPaymentSelection = Boolean(
    searchParams.get("rcv") ||
      searchParams.get("mint") ||
      searchParams.get("memo") ||
      searchParams.get("min") ||
      searchParams.get("max") ||
      searchParams.get("split") ||
      searchParams.has("public")
  );
  const hasRequestSelection = Boolean(
    searchParams.get("prd") ||
      searchParams.get("ramt") ||
      searchParams.get("rmint")
  );
  const hasSwapSelection = Boolean(
    searchParams.get("buy") ||
      searchParams.get("sell") ||
      searchParams.get("amt") ||
      searchParams.has("sprivate") ||
      searchParams.get("dst") ||
      searchParams.get("smin") ||
      searchParams.get("smax") ||
      searchParams.get("ssplit")
  );
  const [activeTop, setActiveTop] = useState<TopTab>(
    urlTab === "swap" || urlTab === "payment" || urlTab === "request"
      ? urlTab
      : hasPaymentSelection
        ? "payment"
        : hasRequestSelection
          ? "request"
          : hasSwapSelection
            ? "swap"
            : "payment"
  );
  const showPrivatePaymentsNotice =
    activeTop === "payment" && !searchParams.has("public");

  useEffect(() => {
    if (urlTab === "swap" || urlTab === "payment" || urlTab === "request") {
      setActiveTop(urlTab);
      return;
    }

    if (hasPaymentSelection) {
      setActiveTop("payment");
      return;
    }

    if (hasRequestSelection) {
      setActiveTop("request");
      return;
    }

    if (hasSwapSelection) {
      setActiveTop("swap");
      return;
    }

    setActiveTop("payment");
  }, [urlTab, hasPaymentSelection, hasRequestSelection, hasSwapSelection]);

  const updateTabUrl = useCallback(
    (tab: TopTab) => {
      const params = new URLSearchParams(searchParams.toString());
      const paramsToRemove =
        tab === "swap"
          ? [...PAYMENT_QUERY_PARAMS, ...REQUEST_QUERY_PARAMS]
          : tab === "payment"
            ? [...SWAP_QUERY_PARAMS, ...REQUEST_QUERY_PARAMS]
            : [...SWAP_QUERY_PARAMS, ...PAYMENT_QUERY_PARAMS];

      paramsToRemove.forEach((key) => params.delete(key));
      if (tab === "payment") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams]
  );

  return (
    <div className="w-full max-w-[480px] mx-auto">
      {showPrivatePaymentsNotice && (
        <div className="mb-4 w-full pointer-events-none sm:fixed sm:bottom-4 sm:left-1/2 sm:z-30 sm:w-[calc(100vw-2rem)] sm:max-w-[44rem] sm:-translate-x-1/2 xl:max-w-[52rem]">
          <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/5 px-4 py-3 shadow-lg shadow-black/20 backdrop-blur-md">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">
                  Private payments beta
                </div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  The private payments API is in beta and currently
                  undergoing a security audit. It is suitable for testing and
                  pilot integrations while full production rollout is still in
                  progress.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top-level tab switcher */}
      <div className="flex items-center justify-center gap-4 mb-6">
        {topTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTop === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTop(tab.id);
                  updateTabUrl(tab.id);
                }}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all cursor-pointer ${
                  isActive
                    ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTop === "swap" && (
        <SwapCard
          initialBuyMint={initialBuyMint}
          initialSellMint={initialSellMint}
          initialAmount={initialSwapAmount}
        />
      )}
      {activeTop === "payment" && <PaymentCard />}
      {activeTop === "request" && <RequestCard />}
    </div>
  );
}
