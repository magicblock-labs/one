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

## Private USDC CLI

This repo now includes a CLI for repeating the same private USDC transfer without going through the UI flow.

```bash
./ppay <amount> <from-keypair.json> <to-wallet> <repeat> 
```

Example:

```bash 
./ppay 1 Ae4mRHxCtxSbxvxSontR3DTQSkwP49e3sGxrK6BSXkam.json Me4mRHxCtxSbxvxSontR3DTQSkwP49e3sGxrK6BSXkam 20
```

If you want `ppay` available directly on your shell path, run:

```bash
npm link
```

Then you can use:

```bash
ppay 1 <from-keypair.json> <to-wallet> 20
```

The CLI always sends USDC and always builds a private transfer. The `from` argument is the path to the sender secret-key file, and the script derives the sender pubkey from that file.

Accepted `from` file formats:

- JSON array of secret-key bytes
- JSON string containing a base58-encoded secret key
- Raw base58-encoded secret key text

Useful env vars:

- `PAYMENTS_API_BASE_URL`
- `PAYMENTS_CLUSTER`
- `PAYMENTS_USDC_MINT`
- `SOLANA_RPC_URL`
- `PPAY_MIN_DELAY_MS`
- `PPAY_MAX_DELAY_MS`
- `PPAY_SPLIT`
- `PPAY_MEMO`


## Learn More

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.

<a href="https://v0.app/chat/api/kiro/clone/GabrielePicco/magicblock-pay" alt="Open in Kiro"><img src="https://pdgvvgmkdvyeydso.public.blob.vercel-storage.com/open%20in%20kiro.svg?sanitize=true" /></a>
