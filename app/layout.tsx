import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import { Analytics } from '@vercel/analytics/next'
import { SolanaWalletProvider } from '@/components/one/solana-wallet-provider'
import './globals.css'

const _inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const _geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const GOOGLE_ANALYTICS_ID = 'G-YG52DDRMHX'
const DOCS_FAVICON_BASE =
  'https://docs.magicblock.gg/mintlify-assets/_mintlify/favicons/magicblock-42/U_0PfsrxUNdGUMiY/_generated/favicon'

export const metadata: Metadata = {
  title: 'MagicBlock One - Onchain Payment Made Simple',
  description: 'Swap, send, and request payments on Solana with MagicBlock One - the best price, lowest fees, and most tokens.',
  icons: {
    icon: [
      { url: `${DOCS_FAVICON_BASE}/favicon-16x16.png`, sizes: '16x16', type: 'image/png' },
      { url: `${DOCS_FAVICON_BASE}/favicon-32x32.png`, sizes: '32x32', type: 'image/png' },
    ],
    shortcut: `${DOCS_FAVICON_BASE}/favicon.ico`,
    apple: `${DOCS_FAVICON_BASE}/apple-touch-icon.png`,
  },
}

export const viewport: Viewport = {
  themeColor: '#131a2a',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${_inter.variable} ${_geistMono.variable} font-sans antialiased`}>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GOOGLE_ANALYTICS_ID}');
          `}
        </Script>
        <SolanaWalletProvider>
          {children}
        </SolanaWalletProvider>
        <Analytics />
      </body>
    </html>
  )
}
