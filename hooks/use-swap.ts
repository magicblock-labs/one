"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";

export type SwapStatus =
  | "idle"
  | "quoting"
  | "ready"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "confirmed"
  | "error";

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot: number;
  timeTaken: number;
}

interface UseSwapOptions {
  inputMint: string;
  outputMint: string;
  /** Amount in the smallest unit (lamports, etc.) as a string */
  amount: string;
  inputDecimals: number;
  outputDecimals: number;
  slippageBps?: number;
  /** Whether to auto-quote when inputs change */
  enabled?: boolean;
}

function base64ToUint8Array(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function useSwap({
  inputMint,
  outputMint,
  amount,
  inputDecimals,
  outputDecimals,
  slippageBps = 50,
  enabled = true,
}: UseSwapOptions) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const [status, setStatus] = useState<SwapStatus>("idle");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quoteAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived values from quote
  const outputAmount = quote
    ? parseFloat(quote.outAmount) / Math.pow(10, outputDecimals)
    : 0;

  const minimumReceived = quote
    ? parseFloat(quote.otherAmountThreshold) / Math.pow(10, outputDecimals)
    : 0;

  const priceImpact = quote ? parseFloat(quote.priceImpactPct) : 0;

  const routeLabel = quote?.routePlan
    ?.map((r) => r.swapInfo.label)
    .filter(Boolean)
    .join(" -> ") ?? "";

  // Auto-quote when inputs change (debounced 500ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (quoteAbortRef.current) quoteAbortRef.current.abort();

    setQuote(null);
    setError(null);
    setTxSignature(null);

    if (!enabled || !amount || amount === "0" || !inputMint || !outputMint) {
      setStatus("idle");
      return;
    }

    debounceRef.current = setTimeout(() => {
      fetchQuote();
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMint, outputMint, amount, slippageBps, enabled]);

  const fetchQuote = useCallback(async () => {
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const controller = new AbortController();
    quoteAbortRef.current = controller;

    setStatus("quoting");
    setError(null);

    try {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount,
        slippageBps: slippageBps.toString(),
      });

      const res = await fetch(`/api/swap/quote?${params}`, {
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Quote failed: ${res.status}`);
      }

      const quoteData: QuoteResponse = await res.json();
      setQuote(quoteData);
      setStatus("ready");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to get quote");
      setStatus("error");
    }
  }, [inputMint, outputMint, amount, slippageBps]);

  const executeSwap = useCallback(async () => {
    if (!quote || !publicKey || !sendTransaction || !connected) {
      setError("Wallet not connected");
      setStatus("error");
      return;
    }

    try {
      // Step 1: Build the swap transaction
      setStatus("building");
      setError(null);

      const buildRes = await fetch("/api/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: publicKey.toBase58(),
        }),
      });

      if (!buildRes.ok) {
        const errData = await buildRes.json().catch(() => ({}));
        throw new Error(errData.error || `Build failed: ${buildRes.status}`);
      }

      const { swapTransaction, lastValidBlockHeight } = await buildRes.json();

      // Step 2: Deserialize and sign the transaction
      setStatus("signing");

      const transaction = VersionedTransaction.deserialize(
        base64ToUint8Array(swapTransaction)
      );

      // Step 3: Send the transaction with the connected wallet
      setStatus("sending");
      const txid = await sendTransaction(transaction, connection, {
        skipPreflight: true,
        maxRetries: 2,
      });

      setTxSignature(txid);
      setStatus("confirming");

      const confirmation = await connection.confirmTransaction(
        {
          signature: txid,
          blockhash: transaction.message.recentBlockhash,
          lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error("Transaction failed on-chain");
      }

      setStatus("confirmed");
    } catch (err: unknown) {
      console.error("Swap execution error:", err);
      const message =
        err instanceof Error ? err.message : "Swap failed";
      // Don't overwrite "confirmed" status if user rejected in wallet
      if (message.includes("User rejected")) {
        setError("Transaction rejected by user");
      } else {
        setError(message);
      }
      setStatus("error");
    }
  }, [quote, publicKey, sendTransaction, connected, connection]);

  const reset = useCallback(() => {
    setStatus("idle");
    setQuote(null);
    setTxSignature(null);
    setError(null);
  }, []);

  return {
    status,
    quote,
    outputAmount,
    minimumReceived,
    priceImpact,
    routeLabel,
    txSignature,
    error,
    executeSwap,
    reset,
    fetchQuote,
  };
}
