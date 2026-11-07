// ClaimCheck — hand-built seeded demo transactions (5 patterns only, per plan).
//
// These are constructed with @solana/web3.js against a fixed demo keypair.
// They are never broadcast by ClaimCheck itself; the user signs only the
// benign one, and only if they choose to, from their own wallet.

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createSetAuthorityInstruction,
  AuthorityType,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

// Deterministic demo keypair — same "victim" every run, no key material
// that holds real value (Devnet demo only).
const DEMO_SEED = new Uint8Array(32).fill(7);
export const DEMO_VICTIM = Keypair.fromSeed(DEMO_SEED);

// The "attacker" program / address used by the scam seeds, and the other
// demo addresses — derived deterministically from fixed seeds so they are
// always valid 32-byte public keys. No key material here holds real value
// (Devnet demo only).
export const ATTACKER = Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey;
export const FRIEND = Keypair.fromSeed(new Uint8Array(32).fill(23)).publicKey;
export const UNKNOWN_PROGRAM = Keypair.fromSeed(new Uint8Array(32).fill(42)).publicKey;

// A well-known Devnet USDC mint is not needed for the SOL-based seeds;
// the benign seed is a plain SOL transfer, which is what the rule engine
// classifies. (USDC wording in the demo script maps to the same verdict.)

export type SeedId = "assign" | "set-authority" | "transfer-all" | "benign" | "unknown";

export interface Seed {
  id: SeedId;
  label: string;
  tagline: string;
  /** Lamports the demo sender "holds" — used by the transfer-all rule. */
  demoBalanceLamports: number;
  build: () => Transaction;
}

const DEMO_BALANCE = 1_000_000_000; // 1 SOL

function baseTx(): Transaction {
  const tx = new Transaction();
  tx.feePayer = DEMO_VICTIM.publicKey;
  return tx;
}

export const SEEDS: Seed[] = [
  {
    id: "assign",
    label: "Try a scam — Assign",
    tagline: "“Claim your airdrop.” No money moves — but ownership does.",
    demoBalanceLamports: DEMO_BALANCE,
    build: () => {
      const tx = baseTx();
      tx.add(
        SystemProgram.assign({
          accountPubkey: DEMO_VICTIM.publicKey,
          programId: ATTACKER,
        })
      );
      return tx;
    },
  },
  {
    id: "set-authority",
    label: "Try a scam — SetAuthority",
    tagline: "A token account's owner quietly changes hands.",
    demoBalanceLamports: DEMO_BALANCE,
    build: () => {
      const tx = baseTx();
      // A plausible token account for the demo victim (any mint; the
      // instruction shape is what the rule engine reads).
      const fakeMint = new PublicKey("So11111111111111111111111111111111111111112");
      const tokenAccount = getAssociatedTokenAddressSync(
        fakeMint,
        DEMO_VICTIM.publicKey
      );
      tx.add(
        createSetAuthorityInstruction(
          tokenAccount,
          DEMO_VICTIM.publicKey,
          AuthorityType.AccountOwner,
          ATTACKER
        )
      );
      return tx;
    },
  },
  {
    id: "transfer-all",
    label: "Try a scam — Transfer-all",
    tagline: "A “fee” that empties the whole balance.",
    demoBalanceLamports: DEMO_BALANCE,
    build: () => {
      const tx = baseTx();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: DEMO_VICTIM.publicKey,
          toPubkey: ATTACKER,
          lamports: DEMO_BALANCE,
        })
      );
      return tx;
    },
  },
  {
    id: "benign",
    label: "Try a normal payment",
    tagline: "0.05 SOL to a friend. Nothing else changes.",
    demoBalanceLamports: DEMO_BALANCE,
    build: () => {
      const tx = baseTx();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: DEMO_VICTIM.publicKey,
          toPubkey: FRIEND,
          lamports: 50_000_000,
        })
      );
      return tx;
    },
  },
  {
    id: "unknown",
    label: "Try an unknown program",
    tagline: "Calls a program ClaimCheck has never seen.",
    demoBalanceLamports: DEMO_BALANCE,
    build: () => {
      const tx = baseTx();
      tx.add({
        keys: [
          { pubkey: DEMO_VICTIM.publicKey, isSigner: true, isWritable: true },
        ],
        programId: UNKNOWN_PROGRAM,
        data: Buffer.from([0]),
      });
      return tx;
    },
  },
];
