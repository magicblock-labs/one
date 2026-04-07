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
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getBase58Decoder,
} from "@solana/kit";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useWallets as usePrivyWallets } from "@privy-io/react-auth/solana";
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
const base58Decoder = getBase58Decoder();

function getPrivySolanaChain(endpoint: string) {
  const normalizedEndpoint = endpoint.toLowerCase();

  if (normalizedEndpoint.includes("devnet")) {
    return "solana:devnet" as const;
  }

  return "solana:mainnet" as const;
}

function getSolanaWsEndpoint(endpoint: string) {
  if (endpoint.startsWith("https://")) {
    return endpoint.replace("https://", "wss://");
  }

  if (endpoint.startsWith("http://")) {
    return endpoint.replace("http://", "ws://");
  }

  return endpoint;
}

function getSolanaExplorerUrl(
  chain: "solana:mainnet" | "solana:devnet" | "solana:testnet"
) {
  if (chain === "solana:devnet") {
    return "https://explorer.solana.com/?cluster=devnet";
  }

  if (chain === "solana:testnet") {
    return "https://explorer.solana.com/?cluster=testnet";
  }

  return "https://explorer.solana.com";
}

function shortenAddress(address: string | null) {
  if (!address) return "";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function serializeTransaction(
  transaction: Transaction | VersionedTransaction
): Uint8Array {
  if (transaction instanceof VersionedTransaction) {
    return transaction.serialize();
  }

  return transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
}

function deserializeTransaction<T extends Transaction | VersionedTransaction>(
  original: T,
  serializedTransaction: Uint8Array
): T {
  if (original instanceof VersionedTransaction) {
    return VersionedTransaction.deserialize(serializedTransaction) as T;
  }

  return Transaction.from(serializedTransaction) as T;
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

function UnifiedWalletContextProvider({
  children,
  privySolanaChain,
}: {
  children: ReactNode;
  privySolanaChain: "solana:mainnet" | "solana:devnet" | "solana:testnet";
}) {
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
  } = usePrivy();
  const { ready: privyWalletsReady, wallets: privyWallets } = usePrivyWallets();
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

  const privyWallet = privyWallets[0] ?? null;

  const hasPrivyWallet = Boolean(privyAuthenticated && privyWallet);
  const isRestoringPreferredPrivyWallet =
    preferredWalletType === "privy" && (!privyReady || !privyWalletsReady);
  const activeWalletType = useMemo<UnifiedWalletType>(() => {
    if (preferredWalletType === "solana" && solanaConnected) {
      return "solana";
    }

    if (preferredWalletType === "privy" && hasPrivyWallet) {
      return "privy";
    }

    if (isRestoringPreferredPrivyWallet) {
      return null;
    }

    if (solanaConnected) {
      return "solana";
    }

    if (hasPrivyWallet) {
      return "privy";
    }

    return null;
  }, [
    hasPrivyWallet,
    isRestoringPreferredPrivyWallet,
    preferredWalletType,
    solanaConnected,
  ]);

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
    if (solanaConnected) {
      await disconnectSolanaWallet();
    }

    if (privyAuthenticated) {
      await logout();
    }

    persistPreferredWalletType(null);
  }, [
    disconnectSolanaWallet,
    logout,
    persistPreferredWalletType,
    privyAuthenticated,
    solanaConnected,
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
        const { signedTransaction } = await privyWallet.signTransaction({
          transaction: serializeTransaction(transaction),
          chain: privySolanaChain,
        });

        return deserializeTransaction(transaction, signedTransaction);
      }

      throw new Error("Wallet not connected");
    },
    [activeWalletType, privySolanaChain, privyWallet, signSolanaTransaction]
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
        void connection;

        const { signature } = await privyWallet.signAndSendTransaction({
          transaction: serializeTransaction(transaction),
          chain: privySolanaChain,
          options,
        });

        return base58Decoder.decode(signature);
      }

      throw new Error("Wallet not connected");
    },
    [activeWalletType, privySolanaChain, privyWallet, publicKey, sendSolanaTransaction]
  );

  const walletLabel =
    activeWalletType === "solana"
      ? solanaWallet?.adapter.name ?? "Solana Wallet"
      : activeWalletType === "privy"
        ? privyWallet?.standardWallet.name ?? "Privy"
        : null;
  const walletIcon =
    activeWalletType === "solana"
      ? solanaWallet?.adapter.icon ?? null
      : activeWalletType === "privy"
        ? privyWallet?.standardWallet.icon ?? null
        : null;

  const value = useMemo<UnifiedWalletContextValue>(
    () => ({
      ready: privyReady && privyWalletsReady,
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
      privyWallet,
      privyWalletsReady,
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
  const privySolanaChain = useMemo(() => getPrivySolanaChain(endpoint), [endpoint]);
  const privySolanaConfig = useMemo(
    () => ({
      rpcs: {
        [privySolanaChain]: {
          rpc: createSolanaRpc(endpoint),
          rpcSubscriptions: createSolanaRpcSubscriptions(
            getSolanaWsEndpoint(endpoint)
          ),
          blockExplorerUrl: getSolanaExplorerUrl(privySolanaChain),
        },
      },
    }),
    [endpoint, privySolanaChain]
  );
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
              solana: privySolanaConfig,
              loginMethods: ["email"],
            }}
          >
            <UnifiedWalletContextProvider privySolanaChain={privySolanaChain}>
              {children}
            </UnifiedWalletContextProvider>
          </PrivyProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
