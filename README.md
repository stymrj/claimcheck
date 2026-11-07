# ClaimCheck

**Read a Solana transaction before you sign it — in plain English, with the dangerous parts flagged.**

Built during the MLH Solana Hackathon (Nov 6–8, 2026) · **AI Track**. Devnet only.

## The problem

Your friend gets a "claim your airdrop" link. The wallet preview says no money moves, so it looks safe. It isn't. Since Dec 2025, `Assign` drainers show *no balance change* in wallet previews — yet hand ownership of your account to another program. Wallet simulation alone is blind to it.

ClaimCheck reads the transaction's instructions before you sign and flags what simulation misses.

## How it works

**Rules decide the verdict. The LLM only explains it.**

1. Connect Phantom (Devnet).
2. Click a seeded example — or paste a base64-serialised transaction.
3. ClaimCheck simulates it on Devnet, parses every instruction, and applies deterministic rules:

| Pattern | Verdict |
|---|---|
| `Assign` — account owner changed, no balance change | 🔴 DO NOT SIGN |
| `SetAuthority` on a token account | 🔴 DO NOT SIGN |
| Transfer of ~all of the sender's balance (drain-style) | 🔴 DO NOT SIGN |
| Unknown program, no authority change | 🟡 Unknown — don't sign unless you recognise it |
| Ordinary transfer, no permission change | 🟢 Looks safe |

4. An LLM (optional) explains the same transaction in plain English **below** the rule verdict. It can never override a rule — if the key is missing or the call fails, the rule verdict still stands.
5. **Scan my wallet** lists your token accounts and flags any whose authority is not you, plus checks who owns your SOL account.
6. The app **never auto-signs**. Only the green-verdict demo payment offers a sign-and-send button, and only from your own connected wallet, by explicit click.

## Demo (2 minutes)

1. "Try a scam — Assign" → RED verdict, raw `Assign` instruction shown, plain-English explanation below.
2. "Try a normal payment" → GREEN verdict. Same UI, opposite verdict, rule-driven.
3. "Scan my wallet" → token-account authorities listed, non-user authority flagged.
4. Fee maths on screen (~5000 lamports — about a tenth of a cent at typical SOL prices; Devnet, no real money).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Phantom: switch to **Devnet** (Settings → Developer Settings → Change Network, or the network picker) and fund the wallet from the [Devnet faucet](https://faucet.solana.com).

Optional LLM explanation — either set an env var or paste a key in the app (stored only in your browser, never sent anywhere except the explanation endpoint):

```bash
cp .env.example .env.local   # set OPENAI_API_KEY
```

## Verify the rule engine (no browser needed)

```bash
node test-rules.ts
# PASS assign / set-authority / transfer-all → red
# PASS benign → green
# PASS unknown → amber
```

## Tech

- Next.js 16 (App Router) + TypeScript + Tailwind
- `@solana/web3.js`, `@solana/spl-token`, `@solana/wallet-adapter-react` (Phantom)
- Devnet RPC only. No custom on-chain program, no mainnet, no login/auth.
- LLM explanation via `POST /api/explain` (OpenAI-compatible chat completions, `gpt-4o-mini` by default).

## Honest limits

- Experimental tool, not a guarantee of safety.
- Demo covers 5 hand-built patterns, not every transaction in the wild.
- Never sign what you don't understand, even if a tool says green.

## AI-use disclosure

AI assistance was used during the hacking weekend for code generation, debugging, and drafting explanations. The core logic, rule-based verdicts, demo design, and final submission decisions are the participant's. The LLM explains transactions; it does not decide verdicts — deterministic rules do.
