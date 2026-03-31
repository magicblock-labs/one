"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ConnectionProvider,
  useWallet,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import {
  useWalletModal,
  WalletModalProvider,
} from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { SOLANA_PUBLIC_RPC_ENDPOINT } from "@/lib/solana-rpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import "@solana/wallet-adapter-react-ui/styles.css";

export const PRIVY_APP_ID =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmnd6ca7v00630dl8emdgs1x7";
export const PRIVY_CLIENT_ID =
  process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID ||
  "client-WY6XmBxox4iJmMUk6hMT2nfEdv5qq4qWzDAmFoi51h44W";

type UnifiedWalletType = "solana" | "privy" | null;

type UnifiedSendTransactionOptions = {
  skipPreflight?: boolean;
  maxRetries?: number;
};

type UnifiedWalletContextValue = {
  ready: boolean;
  connected: boolean;
  walletType: UnifiedWalletType;
  address: string | null;
  publicKey: PublicKey | null;
  displayAddress: string;
  walletLabel: string | null;
  walletIcon: string | null;
  openConnectModal: () => void;
  connectSolanaWallet: () => void;
  connectPrivyWallet: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    transaction: T
  ) => Promise<T>;
  sendTransaction: (
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: UnifiedSendTransactionOptions
  ) => Promise<string>;
};

const ACTIVE_WALLET_STORAGE_KEY = "magicblock-pay.active-wallet-type";

const UnifiedWalletContext = createContext<UnifiedWalletContextValue | null>(
  null
);

function shortenAddress(address: string | null) {
  if (!address) return "";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function ConnectWalletDialog({
  open,
  onOpenChange,
  onSolanaClick,
  onPrivyClick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSolanaClick: () => void;
  onPrivyClick: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Connect wallet</DialogTitle>
          <DialogDescription>
            Choose how you want to connect to MagicBlock Pay.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <button
            type="button"
            onClick={onSolanaClick}
            className="rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
          >
            <div className="font-medium text-foreground">Solana wallet</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Connect Phantom, Solflare, or another browser wallet.
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              void onPrivyClick();
            }}
            className="rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
          >
            <div className="font-medium text-foreground">Privy</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Sign in with Privy and use an embedded Solana wallet.
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UnifiedWalletContextProvider({ children }: { children: ReactNode }) {
  const {
    connected: solanaConnected,
    disconnect: disconnectSolanaWallet,
    publicKey: solanaPublicKey,
    sendTransaction: sendSolanaTransaction,
    signTransaction: signSolanaTransaction,
    wallet: solanaWallet,
  } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const {
    authenticated: privyAuthenticated,
    login,
    logout,
    ready: privyReady,
    user,
  } = usePrivy();
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [preferredWalletType, setPreferredWalletType] =
    useState<UnifiedWalletType>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedWalletType = window.localStorage.getItem(
      ACTIVE_WALLET_STORAGE_KEY
    ) as UnifiedWalletType;
    if (
      storedWalletType === "solana" ||
      storedWalletType === "privy" ||
      storedWalletType === null
    ) {
      setPreferredWalletType(storedWalletType);
    }
  }, []);

  const persistPreferredWalletType = useCallback((walletType: UnifiedWalletType) => {
    setPreferredWalletType(walletType);
    if (typeof window === "undefined") return;

    if (walletType) {
      window.localStorage.setItem(ACTIVE_WALLET_STORAGE_KEY, walletType);
      return;
    }

    window.localStorage.removeItem(ACTIVE_WALLET_STORAGE_KEY);
  }, []);

  const privyWallet = useMemo(() => {
    if (!user) return null;

    const linkedAccounts = (
      user as unknown as { linkedAccounts?: Array<Record<string, unknown>> }
    ).linkedAccounts;

    if (!linkedAccounts?.length) {
      return null;
    }

    const solanaWallet =
      linkedAccounts.find(
        (account) =>
          account.type === "wallet" &&
          account.chainType === "solana" &&
          account.walletClientType === "privy"
      ) ??
      linkedAccounts.find(
        (account) => account.type === "wallet" && account.chainType === "solana"
      );

    if (!solanaWallet || typeof solanaWallet.address !== "string") {
      return null;
    }

    return {
      address: solanaWallet.address,
    };
  }, [user]);

  const hasPrivyWallet = Boolean(privyAuthenticated && privyWallet);
  const activeWalletType = useMemo<UnifiedWalletType>(() => {
    if (preferredWalletType === "solana" && solanaConnected) {
      return "solana";
    }

    if (preferredWalletType === "privy" && hasPrivyWallet) {
      return "privy";
    }

    if (solanaConnected) {
      return "solana";
    }

    if (hasPrivyWallet) {
      return "privy";
    }

    return null;
  }, [hasPrivyWallet, preferredWalletType, solanaConnected]);

  useEffect(() => {
    if (activeWalletType) {
      persistPreferredWalletType(activeWalletType);
      return;
    }

    if (!solanaConnected && !hasPrivyWallet) {
      persistPreferredWalletType(null);
    }
  }, [
    activeWalletType,
    hasPrivyWallet,
    persistPreferredWalletType,
    solanaConnected,
  ]);

  const address =
    activeWalletType === "solana"
      ? solanaPublicKey?.toBase58() ?? null
      : privyWallet?.address ?? null;

  const publicKey = useMemo(() => {
    if (!address) return null;

    try {
      return new PublicKey(address);
    } catch {
      return null;
    }
  }, [address]);

  const connectSolanaWallet = useCallback(() => {
    persistPreferredWalletType("solana");
    setIsConnectModalOpen(false);
    setWalletModalVisible(true);
  }, [persistPreferredWalletType, setWalletModalVisible]);

  const connectPrivyWallet = useCallback(async () => {
    persistPreferredWalletType("privy");
    setIsConnectModalOpen(false);
    await login();
  }, [login, persistPreferredWalletType]);

  const disconnect = useCallback(async () => {
    if (activeWalletType === "solana") {
      await disconnectSolanaWallet();
    }

    if (activeWalletType === "privy") {
      await logout();
    }

    persistPreferredWalletType(null);
  }, [
    activeWalletType,
    disconnectSolanaWallet,
    logout,
    persistPreferredWalletType,
  ]);

  const signTransaction = useCallback(
    async <T extends Transaction | VersionedTransaction>(transaction: T) => {
      if (activeWalletType === "solana") {
        if (!signSolanaTransaction) {
          throw new Error("Selected Solana wallet cannot sign transactions");
        }

        return (await signSolanaTransaction(transaction)) as T;
      }

      if (activeWalletType === "privy" && privyWallet) {
        void transaction;
        throw new Error(
          "Privy Solana transaction signing is disabled in the Turbopack build"
        );
      }

      throw new Error("Wallet not connected");
    },
    [activeWalletType, privyWallet, signSolanaTransaction]
  );

  const sendTransaction = useCallback(
    async (
      transaction: Transaction | VersionedTransaction,
      connection: Connection,
      options?: UnifiedSendTransactionOptions
    ) => {
      if (activeWalletType === "solana") {
        if (!publicKey) {
          throw new Error("Wallet not connected");
        }

        return sendSolanaTransaction(transaction, connection, options);
      }

      if (activeWalletType === "privy" && privyWallet) {
        void transaction;
        void connection;
        void options;
        throw new Error(
          "Privy Solana transaction sending is disabled in the Turbopack build"
        );
      }

      throw new Error("Wallet not connected");
    },
    [activeWalletType, privyWallet, publicKey, sendSolanaTransaction]
  );

  const walletLabel =
    activeWalletType === "solana"
      ? solanaWallet?.adapter.name ?? "Solana Wallet"
      : activeWalletType === "privy"
        ? "Privy"
        : null;
  const walletIcon =
    activeWalletType === "solana" ? solanaWallet?.adapter.icon ?? null : null;

  const value = useMemo<UnifiedWalletContextValue>(
    () => ({
      ready: privyReady,
      connected: Boolean(activeWalletType && publicKey),
      walletType: activeWalletType,
      address,
      publicKey,
      displayAddress: shortenAddress(address),
      walletLabel,
      walletIcon,
      openConnectModal: () => setIsConnectModalOpen(true),
      connectSolanaWallet,
      connectPrivyWallet,
      disconnect,
      signTransaction,
      sendTransaction,
    }),
    [
      activeWalletType,
      address,
      connectPrivyWallet,
      connectSolanaWallet,
      disconnect,
      privyReady,
      publicKey,
      sendTransaction,
      signTransaction,
      walletIcon,
      walletLabel,
    ]
  );

  return (
    <UnifiedWalletContext.Provider value={value}>
      {children}
      <ConnectWalletDialog
        open={isConnectModalOpen}
        onOpenChange={setIsConnectModalOpen}
        onSolanaClick={connectSolanaWallet}
        onPrivyClick={connectPrivyWallet}
      />
    </UnifiedWalletContext.Provider>
  );
}

export function useUnifiedWallet() {
  const context = useContext(UnifiedWalletContext);

  if (!context) {
    throw new Error("useUnifiedWallet must be used within SolanaWalletProvider");
  }

  return context;
}

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => SOLANA_PUBLIC_RPC_ENDPOINT, []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <PrivyProvider
            appId={PRIVY_APP_ID}
            clientId={PRIVY_CLIENT_ID}
            config={{
              appearance: {
                theme: 'dark',
                accentColor: '#696FFD',
                logo: '/images/magicblock-logo.png',
              },
              loginMethods: ["email"],
            }}
          >
            <UnifiedWalletContextProvider>{children}</UnifiedWalletContextProvider>
          </PrivyProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
