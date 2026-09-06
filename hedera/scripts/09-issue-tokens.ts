// Issues real bond tokens to a holder. This is the step that makes every
// coupon number downstream genuine instead of theoretical — getCouponAmountFor
// reads live token balance, and a balance of zero makes every fraction zero
// regardless of the coupon rate.
//
// issue() checks the RECIPIENT's own compliance (ERC1594.sol:
// onlyCompliant(address(0), _tokenHolder, false) — checkSender=false, so the
// caller is never checked here, only the holder). An unauthorized recipient
// makes this revert with AccountIsBlocked before minting anything — issuance
// is gated by the same mirror as transfers, not a separate, weaker check.
//
// Run: npm run hedera:issue -- 0xInvestorAddress 100

import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { bondErc20Abi } from "../src/abi.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

async function main() {
  const holder = process.argv[2];
  const wholeUnitsArg = process.argv[3];
  if (!holder || !wholeUnitsArg) {
    throw new Error("Usage: npm run hedera:issue -- <holderAddress> <wholeUnits>   (e.g. 100)");
  }
  const wholeUnits = Number(wholeUnitsArg);
  if (!Number.isFinite(wholeUnits) || wholeUnits <= 0) {
    throw new Error(`<wholeUnits> must be a positive number, got "${wholeUnitsArg}"`);
  }

  const bond = requireEnv("BOND_ADDRESS") as `0x${string}`;
  const account = getIssuerAccount();
  const walletClient = getWalletClient();

  const [decimals, totalSupplyBefore, balanceBefore] = await Promise.all([
    publicClient.readContract({ address: bond, abi: bondErc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: bond, abi: bondErc20Abi, functionName: "totalSupply" }),
    publicClient.readContract({
      address: bond,
      abi: bondErc20Abi,
      functionName: "balanceOf",
      args: [holder as `0x${string}`],
    }),
  ]);

  const value = BigInt(wholeUnits) * 10n ** BigInt(decimals);

  console.log(`Bond:     ${bond}`);
  console.log(`Holder:   ${holder}`);
  console.log(`Issuing:  ${wholeUnits} (${value} raw units, ${decimals} decimals)`);
  console.log(`Supply before:  ${totalSupplyBefore}`);
  console.log(`Balance before: ${balanceBefore}`);
  console.log();

  // Simulate first — if the holder is not currently authorized on the
  // mirror, this reverts here with a decoded AccountIsBlocked rather than
  // after spending gas.
  const { request } = await publicClient.simulateContract({
    address: bond,
    abi: bondErc20Abi,
    functionName: "issue",
    args: [holder as `0x${string}`, value, "0x"],
    account,
  });

  const hash = await walletClient.writeContract(request);
  console.log(`Issue tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`issue() reverted. Receipt status: ${receipt.status}`);
  }

  // Read state back rather than trusting the receipt.
  const [totalSupplyAfter, balanceAfter] = await Promise.all([
    publicClient.readContract({ address: bond, abi: bondErc20Abi, functionName: "totalSupply" }),
    publicClient.readContract({
      address: bond,
      abi: bondErc20Abi,
      functionName: "balanceOf",
      args: [holder as `0x${string}`],
    }),
  ]);

  console.log();
  console.log(`Supply after:  ${totalSupplyAfter}`);
  console.log(`Balance after: ${balanceAfter}`);

  if (balanceAfter !== balanceBefore + value) {
    throw new Error(
      `Balance did not increase by the issued amount. Expected ${balanceBefore + value}, got ${balanceAfter}.`,
    );
  }
  if (totalSupplyAfter !== totalSupplyBefore + value) {
    throw new Error("Total supply did not increase by the issued amount.");
  }
  console.log("\nVerified: balance and total supply both increased by exactly the issued amount.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
