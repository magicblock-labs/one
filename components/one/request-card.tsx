"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Copy,
  Check,
  X,
  Trash2,
  Download,
  QrCode,
  FileText,
  Tag,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type AggregatorToken,
  FALLBACK_TOKENS,
  findTokenByMint,
} from "@/lib/tokens";
import { usePrices } from "@/hooks/use-sol-price";
import { useAggregatorTokens } from "@/hooks/use-aggregator-tokens";
import { PAYMENTS_DEFAULT_USDC_MINT } from "@/lib/payments";
import { TokenSelectModal } from "./token-select-modal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUnifiedWallet } from "@/app/wallet/solana-wallet-provider";

interface PaymentRequest {
  id: string;
  name: string;
  description: string;
  amount: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenLogoURI: string;
  recipientAddress: string;
  link: string;
  createdAt: number;
}

export function RequestCard() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { connected, openConnectModal, publicKey } = useUnifiedWallet();

  const [name, setName] = useState(() => searchParams.get("prd") ?? "");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(() => {
    const initialAmount = searchParams.get("ramt")?.trim() ?? "";
    return /^\d*\.?\d*$/.test(initialAmount) ? initialAmount : "";
  });
  const [tokenMint, setTokenMint] = useState(
    () => searchParams.get("rmint")?.trim() || PAYMENTS_DEFAULT_USDC_MINT
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [generatedRequest, setGeneratedRequest] = useState<PaymentRequest | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const qrRef = useRef<HTMLDivElement>(null);

  const { tokens } = useAggregatorTokens();

  const selectedToken = useMemo(
    () => findTokenByMint(tokenMint, tokens) ?? FALLBACK_TOKENS[1],
    [tokenMint, tokens]
  );

  const { prices } = usePrices([tokenMint]);
  const tokenPrice = prices[tokenMint]?.usd ?? 0;

  const amountUsd = useMemo(() => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return 0;
    return amt * tokenPrice;
  }, [amount, tokenPrice]);

  const qrLogoSrc = useMemo(() => {
    if (!generatedRequest?.tokenLogoURI) {
      return "/images/magicblock-logo.png";
    }

    return `/api/token-logo?src=${encodeURIComponent(generatedRequest.tokenLogoURI)}`;
  }, [generatedRequest?.tokenLogoURI]);

  const handleTokenSelect = useCallback((token: AggregatorToken) => {
    setTokenMint(token.address);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const shouldPersistMint = tokenMint !== PAYMENTS_DEFAULT_USDC_MINT;
    const nextMint = shouldPersistMint ? tokenMint : "";
    const currentProductName = params.get("prd") ?? "";
    const currentAmount = params.get("ramt") ?? "";
    const currentMint = params.get("rmint") ?? "";
    const currentTab = params.get("tab") ?? "";

    if (
      currentProductName === name &&
      currentAmount === amount &&
      currentMint === nextMint &&
      currentTab === "request"
    ) {
      return;
    }

    params.set("tab", "request");

    if (name) {
      params.set("prd", name);
    } else {
      params.delete("prd");
    }

    if (amount) {
      params.set("ramt", amount);
    } else {
      params.delete("ramt");
    }

    if (nextMint) {
      params.set("rmint", nextMint);
    } else {
      params.delete("rmint");
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [name, amount, tokenMint, pathname, router, searchParams]);

  const requestMemoBase = useMemo(() => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (trimmedName && trimmedDescription) {
      return `${trimmedName} - ${trimmedDescription}`;
    }

    return trimmedName || trimmedDescription || "";
  }, [name, description]);

  const generatePaymentLink = useCallback((requestId: string) => {
    if (!publicKey || typeof window === "undefined") return "";

    const url = new URL(pathname, window.location.origin);
    url.searchParams.set("tab", "payment");
    url.searchParams.set("rcv", publicKey.toBase58());
    url.searchParams.set("mint", tokenMint);

    const requestMemo = requestMemoBase
      ? `${requestMemoBase} (${requestId})`
      : `(${requestId})`;
    url.searchParams.set("memo", requestMemo);

    return url.toString();
  }, [publicKey, pathname, tokenMint, requestMemoBase]);

  const handleGenerateRequest = useCallback(() => {
    if (!publicKey || !amount || parseFloat(amount) <= 0) return;

    const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const link = generatePaymentLink(requestId);

    const request: PaymentRequest = {
      id: requestId,
      name: name || "Payment Request",
      description: description,
      amount: amount,
      tokenMint: tokenMint,
      tokenSymbol: selectedToken.symbol,
      tokenLogoURI: selectedToken.logoURI,
      recipientAddress: publicKey.toBase58(),
      link: link,
      createdAt: Date.now(),
    };

    setGeneratedRequest(request);
    setQrModalOpen(true);
  }, [publicKey, amount, name, description, tokenMint, selectedToken, generatePaymentLink]);

  const handleCopy = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const handleDownloadQR = useCallback(() => {
    if (!qrRef.current || !generatedRequest) return;
    const canvas = qrRef.current.querySelector("canvas");
    if (!canvas) return;

    const exportCanvas = document.createElement("canvas");
    const context = exportCanvas.getContext("2d");
    if (!context) return;

    const padding = 24;
    const radius = 20;
    const borderWidth = 2;
    const width = canvas.width + padding * 2;
    const height = canvas.height + padding * 2;
    const backgroundColor =
      window.getComputedStyle(qrRef.current).backgroundColor || "#111827";
    const borderColor = "rgba(255, 255, 255, 0.08)";

    exportCanvas.width = width;
    exportCanvas.height = height;

    context.beginPath();
    context.moveTo(radius, 0);
    context.lineTo(width - radius, 0);
    context.arcTo(width, 0, width, radius, radius);
    context.lineTo(width, height - radius);
    context.arcTo(width, height, width - radius, height, radius);
    context.lineTo(radius, height);
    context.arcTo(0, height, 0, height - radius, radius);
    context.lineTo(0, radius);
    context.arcTo(0, 0, radius, 0, radius);
    context.closePath();

    context.fillStyle = backgroundColor;
    context.fill();
    context.lineWidth = borderWidth;
    context.strokeStyle = borderColor;
    context.stroke();

    context.drawImage(canvas, padding, padding);

    const link = document.createElement("a");
    link.download = `payment-request-${generatedRequest.id}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  }, [generatedRequest]);

  const handleReset = useCallback(() => {
    setGeneratedRequest(null);
    setQrModalOpen(false);
    setName("");
    setDescription("");
    setAmount("");
  }, []);

  const canGenerate = connected && amount && parseFloat(amount) > 0;

  return (
    <>
      <div className="w-full max-w-[480px] mx-auto">
        <div className="rounded-2xl bg-[var(--surface-container)] border border-border/40 shadow-xl shadow-black/30 overflow-hidden">
          {/* Product Name */}
          <div className="mx-3 mt-3">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Tag className="w-3.5 h-3.5" />
                Product / Service Name
              </div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Coffee, Subscription, Donation"
                maxLength={60}
                className="w-full bg-transparent text-foreground text-base placeholder:text-muted-foreground/40 outline-none"
              />
            </div>
          </div>

          {/* Description */}
          <div className="mx-3 mt-2">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/30 p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <FileText className="w-3.5 h-3.5" />
                Brief Description (optional)
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add details about what this payment is for..."
                maxLength={200}
                rows={2}
                className="w-full bg-transparent text-foreground text-sm placeholder:text-muted-foreground/40 outline-none resize-none"
              />
              <div className="text-right text-xs text-muted-foreground/60 mt-1">
                {description.length}/200
              </div>
            </div>
          </div>

          {/* Amount & Token */}
          <div className="mx-3 mt-2">
            <div className="rounded-xl bg-[var(--surface-inner)] border border-border/50 p-4">
              <div className="text-xs text-muted-foreground mb-3">Request Amount</div>
              <div className="flex items-center justify-between">
                {/* Temporary: restore onClick, hover styles, and ChevronDown below to re-enable token selection. */}
                <button
                  disabled
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-accent/60 transition-colors cursor-default"
                >
                  {selectedToken.logoURI ? (
                    <img
                      src={selectedToken.logoURI}
                      alt={selectedToken.symbol}
                      className="w-7 h-7 rounded-full"
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {selectedToken.symbol.charAt(0)}
                    </div>
                  )}
                  <span className="text-foreground font-semibold text-sm">
                    {selectedToken.symbol}
                  </span>
                  {/* <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> */}
                </button>
                <div className="text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^\d*\.?\d*$/.test(v)) {
                        setAmount(v);
                      }
                    }}
                    placeholder="0.00"
                    className="bg-transparent text-right text-2xl font-light text-foreground placeholder:text-muted-foreground/30 outline-none w-32"
                  />
                  <div className="text-xs text-muted-foreground mt-1">
                    ~ ${amountUsd > 0 ? amountUsd.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0.00"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recipient Info */}
          {connected && publicKey && (
            <div className="mx-3 mt-2 flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--surface-inner)] border border-border/30">
              <div className="text-xs text-muted-foreground">
                Payment will be received at
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-foreground/70">
                  {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
                </span>
                <button
                  onClick={() => handleCopy(publicKey.toBase58(), "wallet")}
                  className="p-1 rounded-md hover:bg-accent transition-colors cursor-pointer"
                >
                  {copiedField === "wallet" ? (
                    <Check className="w-3 h-3 text-success" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Generate Button */}
          <div className="p-3 pt-3">
            {!connected ? (
              <button
                onClick={openConnectModal}
                className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-base hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer"
              >
                Connect Wallet
              </button>
            ) : !canGenerate ? (
              <button
                disabled
                className="w-full py-4 rounded-xl bg-secondary text-muted-foreground font-semibold text-base cursor-not-allowed"
              >
                Enter an amount
              </button>
            ) : (
              <button
                onClick={handleGenerateRequest}
                className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-base hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <QrCode className="w-5 h-5" />
                Generate Payment Link
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Token Select Modal */}
      <TokenSelectModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSelect={handleTokenSelect}
        disabledMint=""
      />

      {/* QR Code Modal */}
      <Dialog open={qrModalOpen} onOpenChange={setQrModalOpen}>
        <DialogContent className="sm:max-w-[420px] bg-card border-border p-0 gap-0" showCloseButton={false} aria-describedby={undefined}>
          <DialogHeader className="p-5 pb-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg font-semibold text-foreground">
                Share Link
              </DialogTitle>
              <button
                onClick={() => setQrModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-accent transition-colors cursor-pointer"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          </DialogHeader>

          {generatedRequest && (
            <div className="p-5 pt-4">
              {/* QR Code Card */}
              <div className="rounded-2xl bg-background p-6 flex flex-col items-center" ref={qrRef}>
                {/* QR Code with logo */}
                <div className="relative">
                  <QRCodeCanvas
                    value={generatedRequest.link}
                    size={220}
                    level="M"
                    bgColor="transparent"
                    fgColor="#ffffff"
                    marginSize={0}
                    imageSettings={{
                      src: qrLogoSrc,
                      height: 48,
                      width: 48,
                      excavate: true,
                    }}
                  />
                </div>

                {/* Scan text */}
                <div className="mt-4 text-sm text-muted-foreground">
                  Scan QR to pay
                </div>

                {/* Amount */}
                <div className="mt-1 text-3xl font-semibold text-foreground tracking-tight">
                  {parseFloat(generatedRequest.amount).toFixed(4)} {generatedRequest.tokenSymbol}
                </div>

                {/* USD equivalent */}
                <div className="mt-0.5 text-sm text-muted-foreground">
                  ~ ${amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </div>

                {/* Product name if provided */}
                {generatedRequest.name && generatedRequest.name !== "Payment Request" && (
                  <div className="mt-3 px-3 py-1.5 rounded-full bg-secondary/60 text-xs text-foreground/80">
                    {generatedRequest.name}
                  </div>
                )}
              </div>

              {/* Info rows */}
              <div className="mt-4 space-y-2">
                {/* Request ID */}
                <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-secondary/40">
                  <span className="text-sm text-muted-foreground">Request ID</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-foreground">
                      {generatedRequest.id.slice(0, 16)}...
                    </span>
                    <button
                      onClick={() => handleCopy(generatedRequest.id, "id")}
                      className="p-1 rounded-md hover:bg-accent transition-colors cursor-pointer"
                    >
                      {copiedField === "id" ? (
                        <Check className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Payment Link */}
                <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-secondary/40">
                  <span className="text-sm text-muted-foreground">Payment Link</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-foreground max-w-[140px] truncate">
                      {generatedRequest.link.slice(0, 20)}...
                    </span>
                    <button
                      onClick={() => handleCopy(generatedRequest.link, "link")}
                      className="p-1 rounded-md hover:bg-accent transition-colors cursor-pointer"
                    >
                      {copiedField === "link" ? (
                        <Check className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Validity notice */}
              <div className="mt-4 text-center text-xs text-muted-foreground">
                This payment link does not expire.
              </div>

              {/* Action buttons */}
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleReset}
                  className="p-4 rounded-xl bg-destructive/20 hover:bg-destructive/30 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-5 h-5 text-destructive" />
                </button>
                <button
                  onClick={handleDownloadQR}
                  className="flex-1 py-4 rounded-xl bg-secondary hover:bg-secondary/80 transition-colors cursor-pointer flex items-center justify-center gap-2 text-foreground font-medium"
                >
                  <Download className="w-5 h-5" />
                  Save
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
