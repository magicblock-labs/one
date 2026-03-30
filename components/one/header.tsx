"use client";

import {
  Copy,
  Check,
  ExternalLink,
  Code2,
  CircleHelp /*, Settings, BarChart3 */,
  Menu,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnimatedLogo } from "./animated-logo";
import { WalletButton } from "./wallet-button";
// import {
//   Tooltip,
//   TooltipContent,
//   TooltipTrigger,
// } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const FAQ_ITEMS = [
  {
    value: "item-0",
    question: "Is MagicBlock Private Payment API a mixer?",
    answer: (
      <>
        <p>No.</p>
        <p className="mt-3">
          MagicBlock Private Payment API is not a mixer and does not rely on pooling or
          redistributing user funds to obscure ownership.
        </p>
        <p className="mt-3">
          Funds are first locked in a vault on Solana, and release to the
          recipient is authorized through a private intent executed inside
          MagicBlock&apos;s ephemeral rollup. This design is intended to obscure
          the direct on-chain link between sender and recipient while supporting
          compliance through permissioned access, policy enforcement, and AML /
          risk screening.
        </p>
      </>
    ),
  },
  {
    value: "item-1",
    question: "Are private payments truly private?",
    answer: (
      <>
        <p>
          MagicBlock private payments are designed to provide strong privacy,
          but not absolute anonymity.
        </p>
        <p className="mt-3">
          The system obscures the direct on-chain link between sender and
          recipient by separating deposit and payout flows and executing
          transaction logic privately. However, observers may still see funds
          entering and exiting the system on Solana and could attempt
          statistical correlation.
        </p>
        <p className="mt-3">
          Privacy is enhanced through techniques such as batching, splitting,
          and timing variation, making such analysis significantly more
          difficult.
        </p>
      </>
    ),
  },
  {
    value: "item-2",
    question: "Does MagicBlock take custody of funds?",
    answer: (
      <>
        <p>No.</p>
        <p className="mt-3">
          User funds remain controlled by Solana smart contracts. The vault
          operates according to predefined program logic, and release of funds
          is authorized through validated intents. MagicBlock does not take
          discretionary control over user assets.
        </p>
      </>
    ),
  },
  {
    value: "item-3",
    question: "How does MagicBlock support compliance?",
    answer: (
      <>
        <p>MagicBlock Private Payment API is designed to support compliance through:</p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Geo-fencing & Policy-based Access Controls</li>
          <li>AML risk screening of wallets and transactions</li>
          <li>EULA & Licensed deployments</li>
        </ul>
        <p className="mt-3">
          For more information refer to our [compliance framework](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/introduction/compliance-framework) 
        </p>
      </>
    ),
  },
  {
    value: "item-4",
    question: "What trust assumptions does the system rely on?",
    answer: (
      <>
        <p>
          MagicBlock PERs combine execution within the latest Intel Trusted Domain Extension (TDX) with onchain permission access to process private intents securely.
        </p>
        <p className="mt-3">Users and integrators should consider:</p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>The correctness of the underlying Solana smart contracts</li>
          <li>The policies governing access and transaction authorization</li>
          <li>The security guarantees of the hardware manufacturer (Intel TDX)</li>
        </ul>
      </>
    ),
  },
] as const;

export function Header() {
  const pathname = usePathname();
  const { publicKey /*, connected */ } = useWallet();
  const [referModalOpen, setReferModalOpen] = useState(false);
  const [faqModalOpen, setFaqModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const referralLink = typeof window !== "undefined" && publicKey
    ? `${window.location.origin}${pathname}?ref=${publicKey.toBase58()}`
    : "";

  const shortenedLink = publicKey
    ? `${typeof window !== "undefined" ? window.location.host : ""}${pathname}?ref=${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : "";

  const handleCopyLink = useCallback(() => {
    if (referralLink) {
      navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [referralLink]);

  // const handleReferClick = () => {
  //   if (connected) {
  //     setReferModalOpen(true);
  //   }
  // };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between bg-background/80 px-4 py-4 backdrop-blur-md sm:px-6">
      {/* Logo */}
      <Link href="/" aria-label="MagicBlock One" className="flex items-center gap-2">
        <AnimatedLogo className="h-6 w-[7.75rem] sm:h-7 sm:w-[8.75rem]" />
        <div className="flex items-center gap-1.5">
          <span className="translate-y-px text-foreground font-semibold text-base leading-none tracking-tight sm:translate-y-[2px] sm:text-lg">
            One
          </span>
          <span className="translate-y-px rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-primary sm:translate-y-[2px]">
            Beta
          </span>
        </div>
      </Link>

      <div className="flex items-center gap-2 sm:gap-4">
        <button
          type="button"
          onClick={() => setFaqModalOpen(true)}
          className="hidden cursor-pointer items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
        >
          <CircleHelp className="w-4 h-4" />
          <span className="hidden sm:inline">FAQ</span>
        </button>

        {/*
        Refer
        {connected ? (
          <button
            onClick={handleReferClick}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ReferIcon />
            <span className="hidden sm:inline">Refer</span>
          </button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="flex items-center gap-1.5 text-sm text-muted-foreground/50 cursor-not-allowed">
                <ReferIcon />
                <span className="hidden sm:inline">Refer</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[200px]">
              Connect wallet to get your referral link
            </TooltipContent>
          </Tooltip>
        )}
        */}

        {/* Documentation */}
        <a
          href="https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden cursor-pointer items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
        >
          <ExternalLink className="w-4 h-4" />
          <span className="hidden sm:inline">Documentation</span>
        </a>

        {/* Developer API */}
        <a
          href="https://payments.magicblock.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden cursor-pointer items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
        >
          <Code2 className="w-4 h-4" />
          <span className="hidden sm:inline">Developer API</span>
        </a>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open navigation menu"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border bg-transparent text-foreground transition-colors hover:bg-accent sm:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-52 border-border bg-card p-1.5 sm:hidden"
          >
            <DropdownMenuItem
              onSelect={() => setFaqModalOpen(true)}
              className="cursor-pointer gap-2.5"
            >
              <CircleHelp className="h-4 w-4" />
              FAQ
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer gap-2.5">
              <a
                href="https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4" />
                Documentation
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="cursor-pointer gap-2.5">
              <a
                href="https://payments.magicblock.app/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Code2 className="h-4 w-4" />
                Developer API
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={faqModalOpen} onOpenChange={setFaqModalOpen}>
          <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden border-border bg-card p-0 gap-0">
            <DialogHeader className="border-b border-border px-6 py-5">
              <DialogTitle className="text-foreground">FAQ</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Privacy, compliance, and trust assumptions
              </DialogDescription>
            </DialogHeader>

            <div className="overflow-y-auto px-6 py-2">
              <Accordion
                type="single"
                collapsible
                defaultValue={FAQ_ITEMS[0].value}
              >
                {FAQ_ITEMS.map((item) => (
                  <AccordionItem key={item.value} value={item.value}>
                    <AccordionTrigger className="text-base text-foreground hover:no-underline">
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-6 text-muted-foreground">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </DialogContent>
        </Dialog>

        {/*
        Analytics
        <Link
          href="/analytics"
          className={`flex items-center gap-1.5 text-sm transition-colors cursor-pointer ${
            pathname === "/analytics" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span className="hidden sm:inline">Analytics</span>
        </Link>
        */}

        {/* Referral Modal */}
        <Dialog open={referModalOpen} onOpenChange={setReferModalOpen}>
          <DialogContent className="sm:max-w-[420px] bg-card border-border overflow-hidden">
            <DialogHeader>
              <DialogTitle className="text-foreground">Your Referral Link</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Share your unique link and earn <span className="text-primary font-semibold">50%</span> of the fees from each user who joins through your referral.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 w-full overflow-hidden">
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 rounded-lg bg-muted/50 border border-border px-3 py-2.5 text-xs text-foreground font-mono truncate">
                  {shortenedLink}
                </div>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary text-primary-foreground hover:brightness-105 transition-all cursor-pointer flex-shrink-0"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>

              <a
                href="#"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                <span>Learn more about the referral program</span>
              </a>
            </div>
          </DialogContent>
        </Dialog>

        {/*
        Settings
        <button className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <Settings className="w-5 h-5" />
        </button>
        */}

        {/* Wallet Connect */}
        <WalletButton variant="header" />
      </div>
    </header>
  );
}

// function ReferIcon() {
//   return (
//     <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
//       <circle cx="6" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
//       <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
//     </svg>
//   );
// }
