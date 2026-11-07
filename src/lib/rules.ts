// ClaimCheck — deterministic, rule-first verdict engine.
//
// Rules decide the verdict. The LLM only ever explains, in plain English,
// what the rules already found. Nothing here calls an LLM and nothing here
// signs anything.

import {
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  decodeCloseAccountInstruction,
  decodeSetAuthorityInstruction,
  decodeTransferCheckedInstruction,
  decodeTransferInstruction,
} from "@solana/spl-token";

export type VerdictLevel = "red" | "amber" | "green";

export interface Flag {
  code: string;
  title: string;
  detail: string;
  severity: VerdictLevel;
}

export interface ParsedInstruction {
  index: number;
  programId: string;
  programName: string;
  kind: string;
  detail: string;
}

export interface Verdict {
  level: VerdictLevel;
  title: string;
  summary: string;
  flags: Flag[];
  instructions: ParsedInstruction[];
}

export interface RuleContext {
  /** Lamports held by the sender, when known (used for transfer-all detection). */
  senderBalanceLamports?: number;
  /** The connected wallet, when known (used for authority checks). */
  walletPubkey?: string;
}

const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();
const TOKEN_PROGRAM_ID_STR = TOKEN_PROGRAM_ID.toBase58();

function programName(programId: string): string {
  if (programId === SYSTEM_PROGRAM_ID) return "System Program";
  if (programId === TOKEN_PROGRAM_ID_STR) return "SPL Token Program";
  return "Unknown program";
}

function parseInstruction(
  ix: TransactionInstruction,
  index: number,
  ctx: RuleContext
): { parsed: ParsedInstruction; flags: Flag[] } {
  const programId = ix.programId.toBase58();
  const flags: Flag[] = [];
  let kind = "Unknown instruction";
  let detail = `Raw instruction to program ${programId}.`;

  if (programId === SYSTEM_PROGRAM_ID) {
    // SystemProgram instructions: try each known decode in turn.
    try {
      const decoded = SystemInstruction.decodeAssign(ix);
      kind = "Assign";
      detail = `Changes the owner of account ${decoded.accountPubkey.toBase58()} to program ${decoded.programId.toBase58()}. No SOL moves.`;
      flags.push({
        code: "ASSIGN_OWNER_CHANGE",
        title: "Account ownership handed to another program",
        detail:
          "This does NOT send money, so wallet previews show no balance change. It changes who owns your account — after this, the new owner program controls it. This is the exact shape of the Dec 2025 Assign drainers.",
        severity: "red",
      });
      return { parsed: { index, programId, programName: programName(programId), kind, detail }, flags };
    } catch {
      /* not an Assign */
    }
    try {
      const decoded = SystemInstruction.decodeTransfer(ix);
      kind = "Transfer (SOL)";
      const lamports = Number(decoded.lamports);
      const amountSol = lamports / 1e9;
      detail = `Sends ${amountSol} SOL from ${decoded.fromPubkey.toBase58()} to ${decoded.toPubkey.toBase58()}.`;
      if (
        ctx.senderBalanceLamports !== undefined &&
        lamports >= ctx.senderBalanceLamports * 0.95 &&
        lamports > 0
      ) {
        flags.push({
          code: "TRANSFER_ALL",
          title: "Drain-style transfer: nearly the entire balance",
          detail: `This moves ${amountSol} SOL — ~all of the sender's balance (${(ctx.senderBalanceLamports / 1e9).toFixed(4)} SOL). Legitimate payments rarely empty an account.`,
          severity: "red",
        });
      }
      return { parsed: { index, programId, programName: programName(programId), kind, detail }, flags };
    } catch {
      /* not a transfer */
    }
    try {
      const decoded = SystemInstruction.decodeCreateAccount(ix);
      kind = "CreateAccount";
      detail = `Creates a new account owned by ${decoded.programId.toBase58()}, funded with ${Number(decoded.lamports) / 1e9} SOL.`;
      return { parsed: { index, programId, programName: programName(programId), kind, detail }, flags };
    } catch {
      /* not a create */
    }
    kind = "System instruction";
    detail = `A System Program instruction ClaimCheck does not recognise by shape.`;
    flags.push({
      code: "UNKNOWN_SYSTEM_INSTRUCTION",
      title: "Unrecognised System Program instruction",
      detail: "ClaimCheck could not decode this instruction. Do not sign what you cannot read.",
      severity: "amber",
    });
    return { parsed: { index, programId, programName: programName(programId), kind, detail }, flags };
  }

  if (programId === TOKEN_PROGRAM_ID_STR) {
    try {
      const decoded = decodeSetAuthorityInstruction(ix);
      kind = "SetAuthority";
      const authorityType = ["MintTokens", "FreezeAccount", "AccountOwner", "CloseAccount"][decoded.data.authorityType] ?? "Unknown";
      detail = `Changes the ${authorityType} authority of token account ${decoded.keys.account.pubkey.toBase58()} to ${decoded.data.newAuthority?.toBase58() ?? "none"}.`;
      flags.push({
        code: "SET_AUTHORITY",
        title: "Token-account authority changed",
        detail:
          "Whoever holds this authority can move, freeze, or close the tokens in this account. Changing it to an address you do not control hands your tokens away.",
        severity: "red",
      });
      return { parsed: { index, programId, programName: programName(programId), kind, detail }, flags };
    } catch {
      /* not SetAuthority */
    }
    try {
      const decoded = decodeTransferInstruction(ix);
      kind = "Transfer (token)";
      detail = `Sends ${decoded.data.amount.toString()} token units from ${decoded.keys.source.pubkey.toBase58()} to ${decoded.keys.destination.pubkey.toBase58()}.`;
      return { parsed: { index, programId, programName: programName(programId), kind, detail }, flags };
    } catch {
      /* not a token transfer */
    }
    try {
      const decoded = decodeTransferCheckedInstruction(ix);
      kind = "TransferChecked (token)";
      detail = `Sends ${decoded.data.amount.toString()} token units (decimals ${decoded.data.decimals}) from ${decoded.keys.source.pubkey.toBase58()} to ${decoded.keys.destination.pubkey.toBase58()}.`;
      return { parsed: { index, programId, programName: programName(programId), kind, detail }, flags };
    } catch {
      /* not a checked transfer */
    }
    try {
      const decoded = decodeCloseAccountInstruction(ix);
      kind = "CloseAccount";
      detail = `Closes token account ${decoded.keys.account.pubkey.toBase58()}, sending remaining lamports to ${decoded.keys.destination.pubkey.toBase58()}.`;
      flags.push({
        code: "CLOSE_ACCOUNT",
        title: "Token account closed",
        detail: "Closing an account you did not mean to close can strand or move funds unexpectedly.",
        severity: "amber",
      });
      return { parsed: { index, programId, programName: programName(programId), kind, detail }, flags };
    } catch {
      /* not a close */
    }
    kind = "Token instruction";
    detail = `A SPL Token Program instruction ClaimCheck does not recognise by shape.`;
    flags.push({
      code: "UNKNOWN_TOKEN_INSTRUCTION",
      title: "Unrecognised token instruction",
      detail: "ClaimCheck could not decode this instruction. Do not sign what you cannot read.",
      severity: "amber",
    });
    return { parsed: { index, programId, programName: programName(programId), kind, detail }, flags };
  }

  // Unknown program — always amber at minimum.
  flags.push({
    code: "UNKNOWN_PROGRAM",
    title: `Unknown program: ${programId.slice(0, 8)}…${programId.slice(-4)}`,
    detail:
      "This instruction calls a program ClaimCheck has no record of. It may be harmless, or it may do anything at all — there is no way to tell from the program id alone. Do not sign unless you recognise it.",
    severity: "amber",
  });
  return { parsed: { index, programId, programName: programName(programId), kind, detail }, flags };
}

export function analyseTransaction(tx: Transaction, ctx: RuleContext = {}): Verdict {
  const instructions: ParsedInstruction[] = [];
  const flags: Flag[] = [];

  tx.instructions.forEach((ix, i) => {
    const { parsed, flags: ixFlags } = parseInstruction(ix, i, ctx);
    instructions.push(parsed);
    flags.push(...ixFlags);
  });

  const hasRed = flags.some((f) => f.severity === "red");
  const hasAmber = flags.some((f) => f.severity === "amber");

  if (hasRed) {
    const red = flags.filter((f) => f.severity === "red");
    return {
      level: "red",
      title: "DO NOT SIGN",
      summary: `This transaction ${red.map((f) => f.title.toLowerCase()).join("; ")}. It can hand control of your account or tokens to someone else.`,
      flags,
      instructions,
    };
  }
  if (hasAmber) {
    return {
      level: "amber",
      title: "UNKNOWN — DO NOT SIGN UNLESS YOU RECOGNISE IT",
      summary:
        "No permission change was detected, but part of this transaction calls a program ClaimCheck does not recognise. It could be fine, or it could do anything.",
      flags,
      instructions,
    };
  }
  return {
    level: "green",
    title: "LOOKS SAFE",
    summary:
      "Only ordinary transfers were found, with no ownership or authority changes. This is what a normal payment looks like.",
    flags,
    instructions,
  };
}

// Keep PublicKey import used for callers that build seeded txs.
export type { PublicKey };
