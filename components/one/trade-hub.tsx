"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Send,
  Shield as ShieldIcon,
  QrCode,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SwapCard } from "./swap-card";
import { PaymentCard } from "./payment-card";
import { ShieldCard } from "./shield-card";
import { RequestCard } from "./request-card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const topTabs = [
  { id: "payment", label: "Payment", icon: Send },
  { id: "swap", label: "Swap", icon: ArrowLeftRight },
  { id: "shield", label: "Shield", icon: ShieldIcon },
  { id: "request", label: "Request", icon: QrCode },
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
  "fromBalance",
  "toBalance",
] as const;
const REQUEST_QUERY_PARAMS = ["prd", "ramt", "rmint"] as const;
const SHIELD_QUERY_PARAMS = ["shamt", "shmint"] as const;

type TopTab = (typeof topTabs)[number]["id"];

function isTopTab(value: string | null): value is TopTab {
  return (
    value === "payment" ||
    value === "swap" ||
    value === "shield" ||
    value === "request"
  );
}

interface TradeHubProps {
  initialBuyMint?: string;
  initialSellMint?: string;
  initialSwapAmount?: string;
  isSwapDisabled?: boolean;
}

export function TradeHub({
  initialBuyMint,
  initialSellMint,
  initialSwapAmount,
  isSwapDisabled = false,
}: TradeHubProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab");
  const urlTopTab = isTopTab(urlTab) ? urlTab : null;
  const selectableUrlTab =
    urlTopTab === "swap" && isSwapDisabled ? null : urlTopTab;
  const hasPaymentSelection = Boolean(
    searchParams.get("rcv") ||
      searchParams.get("mint") ||
      searchParams.get("memo") ||
      searchParams.get("min") ||
      searchParams.get("max") ||
      searchParams.get("split") ||
      searchParams.get("fromBalance") ||
      searchParams.get("toBalance") ||
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
  const hasShieldSelection = Boolean(
    searchParams.get("shamt") || searchParams.get("shmint")
  );
  const [activeTop, setActiveTop] = useState<TopTab>(
    selectableUrlTab
      ? selectableUrlTab
      : hasPaymentSelection
        ? "payment"
        : hasRequestSelection
          ? "request"
          : hasShieldSelection
            ? "shield"
            : hasSwapSelection && !isSwapDisabled
              ? "swap"
              : "payment"
  );
  const showPrivatePaymentsNotice =
    activeTop === "payment" && !searchParams.has("public");

  useEffect(() => {
    if (selectableUrlTab) {
      setActiveTop(selectableUrlTab);
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

    if (hasShieldSelection) {
      setActiveTop("shield");
      return;
    }

    if (hasSwapSelection && !isSwapDisabled) {
      setActiveTop("swap");
      return;
    }

    setActiveTop("payment");
  }, [
    selectableUrlTab,
    hasPaymentSelection,
    hasRequestSelection,
    hasShieldSelection,
    hasSwapSelection,
    isSwapDisabled,
  ]);

  const updateTabUrl = useCallback(
    (tab: TopTab) => {
      const params = new URLSearchParams(searchParams.toString());
      const paramsToRemove =
        tab === "swap"
          ? [
              ...PAYMENT_QUERY_PARAMS,
              ...REQUEST_QUERY_PARAMS,
              ...SHIELD_QUERY_PARAMS,
            ]
          : tab === "payment"
            ? [
                ...SWAP_QUERY_PARAMS,
                ...REQUEST_QUERY_PARAMS,
                ...SHIELD_QUERY_PARAMS,
              ]
            : tab === "shield"
              ? [
                  ...SWAP_QUERY_PARAMS,
                  ...PAYMENT_QUERY_PARAMS,
                  ...REQUEST_QUERY_PARAMS,
                ]
              : [
                  ...SWAP_QUERY_PARAMS,
                  ...PAYMENT_QUERY_PARAMS,
                  ...SHIELD_QUERY_PARAMS,
                ];

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
        <div className="mb-4 w-full sm:fixed sm:bottom-4 sm:right-4 sm:left-auto sm:z-30 sm:mb-0 sm:w-[calc(100vw-2rem)] sm:max-w-xs">
          <div className="relative rounded-xl border border-yellow-400/20 bg-yellow-400/5 px-4 py-3 shadow-lg shadow-black/20 backdrop-blur-md">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">
                  Shielded payments beta
                </div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  The shielded payments API is in beta and currently
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
      <div className="flex items-center justify-center gap-1 sm:gap-4 mb-6">
        {topTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTop === tab.id;
          const isDisabled = tab.id === "swap" && isSwapDisabled;
          const button = (
            <button
              key={tab.id}
              disabled={isDisabled}
              onClick={() => {
                if (isDisabled) return;
                setActiveTop(tab.id);
                updateTabUrl(tab.id);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-2 text-sm font-medium transition-all sm:gap-2 sm:px-4 ${
                isDisabled
                  ? "pointer-events-none cursor-not-allowed opacity-50"
                  : "cursor-pointer"
              } ${
                isActive
                  ? "text-foreground"
                  : isDisabled
                    ? "text-muted-foreground"
                    : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );

          if (!isDisabled) {
            return button;
          }

          return (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-not-allowed">{button}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px]">
                Swaps are only supported on mainnet
              </TooltipContent>
            </Tooltip>
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
      {activeTop === "shield" && <ShieldCard />}
      {activeTop === "request" && <RequestCard />}
    </div>
  );
}
