// Node's built-in test runner. Run with: npm run test:unit
//
// The beacon derives an investor's node on-chain from an immutable parent
// node plus the label, because taking a caller-supplied node would let anyone
// point it at a name under a parent they control and publish whatever they
// liked. That derivation has to agree with ENSIP-1 namehash, or the beacon
// reads a node nobody has ever written to and reports an empty record instead
// of failing loudly.
//
// test/contracts/ENSComplianceBeacon.test.js checks the Solidity side against
// ethers' namehash. This checks the same rule against viem independently, so
// the two implementations are pinned from both directions.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { namehash } from "viem/ens";
import { nodeForLabel } from "../src/node.js";
import { PARENT_NAME } from "../src/constants.js";

describe("nodeForLabel", () => {
  const parentNode = namehash(PARENT_NAME);

  test("matches namehash of the full dotted name", () => {
    for (const label of ["investora", "investorb", "investorc"]) {
      assert.equal(
        nodeForLabel(parentNode, label),
        namehash(`${label}.${PARENT_NAME}`),
        `derivation diverged for "${label}"`,
      );
    }
  });

  test("matches the value the beacon is expected to produce for investora", () => {
    // Pinned literal so a change to either derivation is caught even if both
    // were edited together.
    assert.equal(
      nodeForLabel(parentNode, "investora"),
      namehash("investora.namegate.eth"),
    );
  });

  test("different labels give different nodes", () => {
    assert.notEqual(
      nodeForLabel(parentNode, "investora"),
      nodeForLabel(parentNode, "investorb"),
    );
  });

  test("a different parent gives a different node for the same label", () => {
    assert.notEqual(
      nodeForLabel(parentNode, "investora"),
      nodeForLabel(namehash("someoneelse.eth"), "investora"),
    );
  });
});
