# magicblock-pay

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_EMIThtdxrBWA8ZYg8iHhzMVIM6ni)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Environment

Private payments use the following environment variables:

- `PAYMENTS_API_BASE_URL`: base URL for the payments API.
- `CLUSTER`: cluster name passed to the payments API and used for Solana Explorer links. Supported values are `devnet`, `testnet`, and `mainnet-beta`.
- `PAYMENTS_CLUSTER`: legacy fallback for the payments API cluster. `CLUSTER` takes precedence if both are set. If this value is an RPC URL containing `devnet`, `testnet`, or `mainnet`, the app infers the corresponding cluster name.
- `NEXT_PUBLIC_PAYMENTS_TEST_USDC_MINT`: overrides the default payment mint in the UI.

Example:

```bash
PAYMENTS_API_BASE_URL=http://localhost:8787 \
CLUSTER=devnet \
SOLANA_RPC_URL=https://rpc.magicblock.app/devnet \
NEXT_PUBLIC_SOLANA_RPC_URL=https://rpc.magicblock.app/devnet \
NEXT_PUBLIC_PAYMENTS_TEST_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
yarn dev -p 3002
```

With `CLUSTER=devnet`, the app sends `cluster=devnet` to the payments API and opens transactions on `https://explorer.solana.com` with the `devnet` cluster selected.

## Learn More

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.

<a href="https://v0.app/chat/api/kiro/clone/GabrielePicco/magicblock-pay" alt="Open in Kiro"><img src="https://pdgvvgmkdvyeydso.public.blob.vercel-storage.com/open%20in%20kiro.svg?sanitize=true" /></a>
