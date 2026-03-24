export interface AggregatorToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI: string;
  tags?: string[];
  daily_volume?: number;
  freeze_authority?: string | null;
  mint_authority?: string | null;
  permanent_delegate?: string | null;
  extensions?: { coingeckoId?: string };
}

export type JupiterToken = AggregatorToken;
export type Token = AggregatorToken;

// Well-known mint addresses
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const DEFAULT_SELL_MINT = USDC_MINT;
export const DEFAULT_BUY_MINT = SOL_MINT;

export const POPULAR_SYMBOLS = ["SOL", "USDC", "USDT", "ETH", "BTC"];

// Hardcoded fallback tokens so the UI renders before the API responds
export const FALLBACK_TOKENS: AggregatorToken[] = [
  {
    address: SOL_MINT,
    name: "Wrapped SOL",
    symbol: "SOL",
    decimals: 9,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    tags: ["verified", "strict", "community"],
    daily_volume: 3_000_000_000,
    extensions: { coingeckoId: "solana" },
  },
  {
    address: USDC_MINT,
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
    tags: ["verified", "strict", "community"],
    daily_volume: 1_500_000_000,
    extensions: { coingeckoId: "usd-coin" },
  },
  {
    address: USDT_MINT,
    name: "Tether USD",
    symbol: "USDT",
    decimals: 6,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg",
    tags: ["verified", "strict", "community"],
    daily_volume: 600_000_000,
    extensions: { coingeckoId: "tether" },
  },
  {
    address: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    name: "Wrapped Ether (Wormhole)",
    symbol: "ETH",
    decimals: 8,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png",
    tags: ["verified", "strict", "community"],
    daily_volume: 500_000_000,
    extensions: { coingeckoId: "ethereum" },
  },
  {
    address: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
    name: "Wrapped BTC (Wormhole)",
    symbol: "BTC",
    decimals: 8,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png",
    tags: ["verified", "strict", "community"],
    daily_volume: 400_000_000,
    extensions: { coingeckoId: "bitcoin" },
  },
  {
    address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    name: "Jupiter",
    symbol: "JUP",
    decimals: 6,
    logoURI:
      "https://static.jup.ag/jup/icon.png",
    tags: ["verified", "strict", "community"],
    daily_volume: 350_000_000,
    extensions: { coingeckoId: "jupiter-exchange-solana" },
  },
  {
    address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    name: "Marinade staked SOL",
    symbol: "mSOL",
    decimals: 9,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png",
    tags: ["verified", "strict", "community"],
    daily_volume: 200_000_000,
    extensions: { coingeckoId: "msol" },
  },
  {
    address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    name: "Bonk",
    symbol: "BONK",
    decimals: 5,
    logoURI:
      "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
    tags: ["verified", "strict", "community"],
    daily_volume: 180_000_000,
    extensions: { coingeckoId: "bonk" },
  },
  {
    address: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",
    name: "Render Token",
    symbol: "RENDER",
    decimals: 8,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof/logo.png",
    tags: ["verified", "strict", "community"],
    daily_volume: 150_000_000,
    extensions: { coingeckoId: "render-token" },
  },
  {
    address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    name: "Pyth Network",
    symbol: "PYTH",
    decimals: 6,
    logoURI:
      "https://pyth.network/token.svg",
    tags: ["verified", "strict", "community"],
    daily_volume: 120_000_000,
    extensions: { coingeckoId: "pyth-network" },
  },
  {
    address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    name: "JITO",
    symbol: "JTO",
    decimals: 9,
    logoURI:
      "https://metadata.jito.network/token/jto/image",
    tags: ["verified", "strict", "community"],
    daily_volume: 100_000_000,
    extensions: { coingeckoId: "jito-governance-token" },
  },
  {
    address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    name: "dogwifhat",
    symbol: "WIF",
    decimals: 6,
    logoURI:
      "https://bafkreibk3covs5ltyqxa272uodhber6rc6gvovfpsfiwpwjtv2q6lz4bpa.ipfs.cf-ipfs.com/",
    tags: ["verified", "strict", "community"],
    daily_volume: 90_000_000,
    extensions: { coingeckoId: "dogwifcoin" },
  },
  {
    address: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",
    name: "Helium Network Token",
    symbol: "HNT",
    decimals: 8,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux/logo.png",
    tags: ["verified", "strict", "community"],
    daily_volume: 80_000_000,
    extensions: { coingeckoId: "helium" },
  },
  {
    address: "RLBxxFkseAZ4RgJH3Sqn8jXxhmGoz9jWxDNJMh8pL7a",
    name: "Raydium",
    symbol: "RAY",
    decimals: 6,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png",
    tags: ["verified", "strict", "community"],
    daily_volume: 70_000_000,
    extensions: { coingeckoId: "raydium" },
  },
  {
    address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
    name: "Orca",
    symbol: "ORCA",
    decimals: 6,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png",
    tags: ["verified", "strict", "community"],
    daily_volume: 60_000_000,
    extensions: { coingeckoId: "orca" },
  },
];

/** Find a token by symbol in a given list, fallback to FALLBACK_TOKENS */
export function findToken(
  symbol: string,
  list?: AggregatorToken[]
): AggregatorToken | undefined {
  const pool = list && list.length > 0 ? list : FALLBACK_TOKENS;
  return pool.find((t) => t.symbol === symbol);
}

/** Find a token by mint address */
export function findTokenByMint(
  mint: string,
  list?: AggregatorToken[]
): AggregatorToken | undefined {
  const pool = list && list.length > 0 ? list : FALLBACK_TOKENS;
  return pool.find((t) => t.address === mint);
}
