"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Connection,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { analyseTransaction, Verdict } from "@/lib/rules";
import { SEEDS, Seed, DEMO_VICTIM, FRIEND } from "@/lib/seeded";

const EXPLORER = "https://explorer.solana.com";

interface SimResult {
  err: string | null;
  logs: string[];
  unitsConsumed?: number;
  feeLamports?: number;
}

interface ScanRow {
  account: string;
  mint: string;
  owner: string;
  amount: string;
  flagged: boolean;
}

const verdictStyles: Record<string, { card: string; badge: string }> = {
  red: {
    card: "border-red-500 bg-red-950/60",
    badge: "bg-red-600 text-white",
  },
  amber: {
    card: "border-amber-500 bg-amber-950/60",
    badge: "bg-amber-500 text-black",
  },
  green: {
    card: "border-emerald-500 bg-emerald-950/60",
    badge: "bg-emerald-600 text-white",
  },
};

export default function Home() {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();

  const [activeSeed, setActiveSeed] = useState<Seed | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [llmKey, setLlmKey] = useState("");

  const [scanRows, setScanRows] = useState<ScanRow[] | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [solOwner, setSolOwner] = useState<string | null>(null);

  const [sendState, setSendState] = useState<string | null>(null);
  const [sentSig, setSentSig] = useState<string | null>(null);

  useEffect(() => {
    try {
      setLlmKey(localStorage.getItem("claimcheck-llm-key") || "");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const saveLlmKey = (v: string) => {
    setLlmKey(v);
    try {
      localStorage.setItem("claimcheck-llm-key", v);
    } catch {
      /* storage unavailable */
    }
  };

  const runAnalysis = useCallback(
    async (tx: Transaction, seed: Seed | null) => {
      setBusy(true);
      setSim(null);
      setSimError(null);
      setVerdict(null);
      setExplanation(null);
      setExplainError(null);
      setSentSig(null);
      setSendState(null);
      try {
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        const v = analyseTransaction(tx, {
          senderBalanceLamports: seed?.demoBalanceLamports,
          walletPubkey: publicKey?.toBase58(),
        });
        setVerdict(v);
        setActiveSeed(seed);
        try {
          const simRes = await connection.simulateTransaction(tx);
          let fee: number | undefined;
          try {
            fee = (await connection.getFeeForMessage(tx.compileMessage())).value ?? undefined;
          } catch {
            /* fee lookup is best-effort */
          }
          setSim({
            err: simRes.value.err ? JSON.stringify(simRes.value.err) : null,
            logs: simRes.value.logs ?? [],
            unitsConsumed: simRes.value.unitsConsumed,
            feeLamports: fee,
          });
        } catch (e) {
          setSimError(`Simulation failed: ${(e as Error).message}. The rule verdict above does not depend on simulation.`);
        }
      } catch (e) {
        setSimError(`Could not prepare transaction: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [connection, publicKey]
  );

  const runSeed = (seed: Seed) => {
    void runAnalysis(seed.build(), seed);
  };

  const runPasted = () => {
    setPasteError(null);
    try {
      const bytes = Buffer.from(pasted.trim(), "base64");
      const tx = Transaction.from(bytes);
      void runAnalysis(tx, null);
    } catch (e) {
      setPasteError(`Could not parse that as a base64 Solana transaction: ${(e as Error).message}`);
    }
  };

  const explain = async () => {
    if (!verdict) return;
    setExplainBusy(true);
    setExplainError(null);
    setExplanation(null);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict: { level: verdict.level, title: verdict.title, summary: verdict.summary },
          instructions: verdict.instructions.map((ix) => ({
            kind: ix.kind,
            detail: ix.detail,
            programName: ix.programName,
          })),
          apiKey: llmKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExplainError(data?.error || `Explanation failed (${res.status}).`);
      } else {
        setExplanation(data.explanation);
      }
    } catch (e) {
      setExplainError(`Could not reach the explanation service: ${(e as Error).message}`);
    } finally {
      setExplainBusy(false);
    }
  };

  const scanWallet = async () => {
    if (!publicKey) return;
    setScanBusy(true);
    setScanError(null);
    setScanRows(null);
    setSolOwner(null);
    try {
      const [parsed, solInfo] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
        connection.getAccountInfo(publicKey),
      ]);
      setSolOwner(solInfo?.owner.toBase58() ?? "account not found on Devnet");
      setScanRows(
        parsed.value.map((a) => {
          const info = a.account.data.parsed.info as {
            mint: string;
            owner: string;
            tokenAmount: { uiAmountString: string };
          };
          return {
            account: a.pubkey.toBase58(),
            mint: info.mint,
            owner: info.owner,
            amount: info.tokenAmount.uiAmountString,
            flagged: info.owner !== publicKey.toBase58(),
          };
        })
      );
    } catch (e) {
      setScanError(`Wallet scan failed: ${(e as Error).message}`);
    } finally {
      setScanBusy(false);
    }
  };

  // Sign & send the benign demo payment from the CONNECTED wallet.
  // Only offered for the green seed, only on Devnet, only by explicit click.
  const sendBenign = async () => {
    if (!publicKey || !sendTransaction) return;
    setSendState("Waiting for your signature in Phantom…");
    setSentSig(null);
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: FRIEND,
          lamports: 50_000_000,
        })
      );
      const sig = await sendTransaction(tx, connection as Connection);
      setSentSig(sig);
      setSendState("Sent on Devnet.");
    } catch (e) {
      setSendState(`Not sent: ${(e as Error).message}`);
    }
  };

  const styles = verdict ? verdictStyles[verdict.level] : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 text-zinc-100">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">ClaimCheck</h1>
        <p className="mt-1 text-zinc-400">
          Read a Solana transaction before you sign it — in plain English, with the dangerous
          parts flagged. <span className="text-zinc-300 font-medium">Devnet only.</span>
        </p>
        <div className="mt-3 rounded-lg border border-amber-500/60 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
          Experimental tool, not a guarantee of safety. ClaimCheck never auto-signs anything.
          Never sign what you don&apos;t understand — even if a tool says green.
        </div>
      </header>

      <section className="mb-6 flex flex-wrap items-center gap-3">
        <WalletMultiButton />
        <span className="text-sm text-zinc-400">
          {connected && publicKey
            ? `Connected: ${publicKey.toBase58().slice(0, 6)}…${publicKey.toBase58().slice(-4)}`
            : "Connect Phantom (Devnet) to scan your wallet or send the benign demo payment."}
        </span>
        <span className="ml-auto rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300">
          Seeded demo wallet: {DEMO_VICTIM.publicKey.toBase58().slice(0, 6)}…
        </span>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">1 · Try a transaction</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {SEEDS.map((seed) => (
            <button
              key={seed.id}
              onClick={() => runSeed(seed)}
              disabled={busy}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-left hover:border-zinc-500 disabled:opacity-50"
            >
              <span className="block font-medium">{seed.label}</span>
              <span className="block text-sm text-zinc-400">{seed.tagline}</span>
            </button>
          ))}
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-sm text-zinc-400">
            Or paste a base64-serialised transaction:
          </label>
          <div className="flex gap-2">
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Base64 transaction…"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            />
            <button
              onClick={runPasted}
              disabled={busy || !pasted.trim()}
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              Analyse
            </button>
          </div>
          {pasteError && <p className="mt-1 text-sm text-red-400">{pasteError}</p>}
        </div>
        {busy && <p className="mt-2 text-sm text-zinc-400">Fetching a blockhash and simulating on Devnet…</p>}
      </section>

      {verdict && styles && (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">2 · Rule verdict — decided by rules, not by AI</h2>
          <div className={`rounded-lg border px-4 py-4 ${styles.card}`}>
            <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${styles.badge}`}>
              {verdict.title}
            </span>
            <p className="mt-2">{verdict.summary}</p>
            {verdict.flags.length > 0 && (
              <ul className="mt-3 space-y-2">
                {verdict.flags.map((f) => (
                  <li key={f.code} className="rounded-md bg-black/30 px-3 py-2 text-sm">
                    <span className="font-semibold">{f.title}</span>
                    <span className="block text-zinc-300">{f.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {verdict.flags.length === 0 && (
              <p className="mt-2 text-sm text-zinc-300">No flags. Only ordinary transfers, no ownership or authority changes.</p>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3">
            <h3 className="font-medium">Instructions in this transaction</h3>
            <ol className="mt-2 space-y-1 text-sm">
              {verdict.instructions.map((ix) => (
                <li key={ix.index} className="font-mono text-xs leading-relaxed text-zinc-300">
                  <span className="text-zinc-100 font-semibold">{ix.kind}</span> · {ix.programName} ·{" "}
                  {ix.detail}
                  <span className="block truncate text-zinc-500">{ix.programId}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm">
            <h3 className="font-medium">Simulation (Devnet)</h3>
            {simError && <p className="mt-1 text-amber-300">{simError}</p>}
            {sim && (
              <ul className="mt-1 space-y-1 text-zinc-300">
                <li>Result: {sim.err ? `failed — ${sim.err}` : "would succeed"}</li>
                {sim.unitsConsumed !== undefined && <li>Compute units: {sim.unitsConsumed}</li>}
                {sim.feeLamports !== undefined && (
                  <li>
                    Fee: {sim.feeLamports} lamports ({(sim.feeLamports / LAMPORTS_PER_SOL).toFixed(7)} SOL) —
                    about a tenth of a cent at typical SOL prices, on Devnet no real money.
                  </li>
                )}
                {sim.logs.length > 0 && (
                  <li>
                    <details>
                      <summary className="cursor-pointer text-zinc-400">Program logs</summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-zinc-400">
                        {sim.logs.join("\n")}
                      </pre>
                    </details>
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3">
            <h3 className="font-medium">Plain-English explanation (LLM explains, never decides)</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                type="password"
                value={llmKey}
                onChange={(e) => saveLlmKey(e.target.value)}
                placeholder="LLM API key (optional — stored only in your browser)"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
              <button
                onClick={explain}
                disabled={explainBusy}
                className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
              >
                {explainBusy ? "Explaining…" : "Explain this transaction"}
              </button>
            </div>
            {explainError && <p className="mt-2 text-sm text-amber-300">{explainError}</p>}
            {explanation && <p className="mt-2 text-sm leading-relaxed text-zinc-200">{explanation}</p>}
            {!explanation && !explainError && (
              <p className="mt-2 text-sm text-zinc-400">
                No key? The rule verdict above is the whole answer — the explanation is a nicety, not the decision.
              </p>
            )}
          </div>

          {activeSeed?.id === "benign" && verdict.level === "green" && (
            <div className="mt-3 rounded-lg border border-emerald-700 bg-emerald-950/40 px-4 py-3">
              <h3 className="font-medium">Optional: sign &amp; send this payment for real (Devnet)</h3>
              <p className="mt-1 text-sm text-zinc-300">
                Sends 0.05 SOL from your connected wallet to the demo friend address. Only this
                green-verdict payment can be sent from here — red verdicts have no send button at all.
              </p>
              <button
                onClick={sendBenign}
                disabled={!connected}
                className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {connected ? "Sign & send 0.05 SOL (Devnet)" : "Connect Phantom first"}
              </button>
              {sendState && <p className="mt-2 text-sm text-zinc-300">{sendState}</p>}
              {sentSig && (
                <p className="mt-1 text-sm">
                  <a
                    className="text-emerald-400 underline"
                    href={`${EXPLORER}/tx/${sentSig}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Solana Explorer (Devnet)
                  </a>
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">3 · Scan my wallet</h2>
        <p className="mb-2 text-sm text-zinc-400">
          Lists your token accounts and flags any whose authority is not you. Also checks who owns
          your SOL account itself.
        </p>
        <button
          onClick={scanWallet}
          disabled={!connected || scanBusy}
          className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {scanBusy ? "Scanning…" : connected ? "Scan my wallet" : "Connect Phantom first"}
        </button>
        {scanError && <p className="mt-2 text-sm text-red-400">{scanError}</p>}
        {solOwner && (
          <p className="mt-2 text-sm text-zinc-300">
            Your SOL account owner: <span className="font-mono text-xs">{solOwner}</span>{" "}
            {solOwner === SystemProgram.programId.toBase58()
              ? "(System Program — as expected)"
              : "(unexpected owner — investigate before signing anything)"}
          </p>
        )}
        {scanRows && (
          <div className="mt-2">
            {scanRows.length === 0 ? (
              <p className="text-sm text-zinc-400">No token accounts found on Devnet for this wallet.</p>
            ) : (
              <ul className="space-y-2">
                {scanRows.map((r) => (
                  <li
                    key={r.account}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      r.flagged ? "border-red-500 bg-red-950/50" : "border-zinc-700 bg-zinc-900"
                    }`}
                  >
                    <span className="font-mono text-xs">{r.account}</span>
                    <span className="block text-zinc-300">
                      Mint {r.mint.slice(0, 8)}… · balance {r.amount} · authority{" "}
                      <span className="font-mono text-xs">{r.owner.slice(0, 8)}…</span>{" "}
                      {r.flagged ? "— NOT YOU ⚠" : "(you)"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <footer className="border-t border-zinc-800 pt-4 text-xs text-zinc-500">
        <p>
          Built during the MLH Solana Hackathon, Nov 6–8 2026 · AI Track. AI assistance was used
          during the hacking weekend for code generation, debugging, and drafting explanations. The
          core logic, rule-based verdicts, demo design, and final submission decisions are the
          participant&apos;s. The LLM explains transactions; it does not decide verdicts —
          deterministic rules do.
        </p>
        <p className="mt-1">
          Demo covers 5 hand-built patterns, not every transaction in the wild. Devnet only.
        </p>
      </footer>
    </main>
  );
}
