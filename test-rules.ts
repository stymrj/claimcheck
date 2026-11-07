// Throwaway verification: run every seeded tx through the rule engine and
// print the verdict. Not part of the app.
import { Transaction } from "@solana/web3.js";
import { analyseTransaction } from "./src/lib/rules";
import { SEEDS } from "./src/lib/seeded";

const expected: Record<string, string> = {
  assign: "red",
  "set-authority": "red",
  "transfer-all": "red",
  benign: "green",
  unknown: "amber",
};

let failures = 0;
for (const seed of SEEDS) {
  const tx = seed.build();
  tx.recentBlockhash = "11111111111111111111111111111111"; // dummy, for serialize only
  // Serialize round-trip, as the UI does for pasted transactions.
  const roundTripped = Transaction.from(
    tx.serialize({ requireAllSignatures: false })
  );
  const v = analyseTransaction(roundTripped, {
    senderBalanceLamports: seed.demoBalanceLamports,
  });
  const ok = v.level === expected[seed.id];
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${seed.id}: level=${v.level} (expected ${expected[seed.id]}) title="${v.title}" flags=[${v.flags.map((f) => f.code).join(",")}] instructions=[${v.instructions.map((i) => i.kind).join(",")}]`
  );
}
console.log(failures === 0 ? "ALL SEEDS PASS" : `${failures} SEED(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
