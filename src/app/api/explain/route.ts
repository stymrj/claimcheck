// ClaimCheck — /api/explain
//
// The LLM explains a transaction in plain English. It NEVER decides the
// verdict: the caller passes the rule verdict in, and the prompt instructs
// the model to explain that verdict, not to re-judge it. If no key is
// configured the route answers 503 and the rule verdict still stands.

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { verdict, instructions, apiKey } = body as {
    verdict?: { level: string; title: string; summary: string };
    instructions?: { kind: string; detail: string; programName: string }[];
    apiKey?: string;
  };

  const key = process.env.OPENAI_API_KEY || apiKey;
  if (!key) {
    return NextResponse.json(
      {
        error:
          "No LLM key configured. Set OPENAI_API_KEY on the server or paste a key in the app — the rule verdict above still stands without it.",
      },
      { status: 503 }
    );
  }
  if (!verdict || !instructions) {
    return NextResponse.json({ error: "verdict and instructions are required." }, { status: 400 });
  }

  const instructionText = instructions
    .map((ix, i) => `${i + 1}. [${ix.programName}] ${ix.kind}: ${ix.detail}`)
    .join("\n");

  const system = [
    "You explain Solana transactions to a non-technical user in plain English.",
    "A deterministic rule engine has ALREADY decided the verdict below. Do not re-judge it, do not soften it, do not contradict it.",
    "Explain, in 3-5 short sentences, what the transaction would do if signed, in the light of that verdict.",
    "Never say a transaction is safe unless the verdict is green. Never invent amounts, tokens, or programs not listed.",
    "End with one line: 'Rule verdict: <title> — decided by rules, not by this explanation.'",
  ].join(" ");

  const user = [
    `Rule verdict: ${verdict.level.toUpperCase()} — ${verdict.title}`,
    `Rule summary: ${verdict.summary}`,
    "Instructions in this transaction:",
    instructionText,
  ].join("\n");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `LLM provider returned ${res.status}. The rule verdict still stands. ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }
    const data = await res.json();
    const explanation = data?.choices?.[0]?.message?.content?.trim();
    if (!explanation) {
      return NextResponse.json({ error: "LLM returned an empty explanation." }, { status: 502 });
    }
    return NextResponse.json({ explanation });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach the LLM provider (${(e as Error).message}). The rule verdict still stands.` },
      { status: 502 }
    );
  }
}
