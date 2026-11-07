import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import WalletProviders from "@/components/WalletProviders";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ClaimCheck — read a Solana transaction before you sign it",
  description:
    "Rule-first pre-sign transaction explainer for Solana (Devnet). Deterministic verdicts flag Assign, SetAuthority, drain-style transfers and unknown programs; an LLM explains, never decides.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <WalletProviders>{children}</WalletProviders>
      </body>
    </html>
  );
}
