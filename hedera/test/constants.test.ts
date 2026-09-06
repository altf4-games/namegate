// Node's built-in test runner. Run with: npm run test:unit
//
// This is a regression guard, not a discovery test: every value here was
// already found to be correct the hard way — deployBond reverted with
// empty return data against v8.0.0-ats-shaped values, and the real fix was
// tracing the deployed factory back to v3.1.0-ats source (see
// hedera/src/constants.ts's header comment and the "Fix ABI version
// mismatch" commit). If any of these ever gets "helpfully" edited back
// toward the wrong version, this test catches it before a live deploy does.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  HEDERA_CHAIN_ID,
  ATS_TESTNET,
  BOND_CONFIG_ID,
  ATS_ROLES,
  RegulationType,
  RegulationSubType,
} from "../src/constants.js";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

describe("hedera/src/constants.ts", () => {
  test("HEDERA_CHAIN_ID is 296 (Hedera testnet, not mainnet's 295 or previewnet's 297)", () => {
    assert.equal(HEDERA_CHAIN_ID, 296);
  });

  describe("ATS_TESTNET addresses", () => {
    test("every address is a well-formed 20-byte address", () => {
      for (const [name, addr] of Object.entries(ATS_TESTNET)) {
        assert.match(addr, ADDRESS, `${name} is not a well-formed address`);
      }
    });

    test("matches the deployed testnet addresses from ATS docs/deployed-addresses.md", () => {
      assert.equal(ATS_TESTNET.factoryProxy, "0x5fA65CA30d1984701F10476664327f97c864A9D3");
      assert.equal(ATS_TESTNET.blrProxy, "0xEFEF4CAe9642631Cfc6d997D6207Ee48fa78fe42");
    });

    test("factoryProxy and factoryImplementation are different addresses (proxy pattern)", () => {
      assert.notEqual(ATS_TESTNET.factoryProxy, ATS_TESTNET.factoryImplementation);
    });
  });

  test("BOND_CONFIG_ID is a well-formed bytes32", () => {
    assert.match(BOND_CONFIG_ID, HEX32);
  });

  describe("ATS_ROLES", () => {
    test("every role is a well-formed bytes32", () => {
      for (const [name, role] of Object.entries(ATS_ROLES)) {
        assert.match(role, HEX32, `${name} is not a well-formed bytes32`);
      }
    });

    test("DEFAULT_ADMIN_ROLE is the zero hash, per OpenZeppelin AccessControl convention", () => {
      assert.equal(
        ATS_ROLES.DEFAULT_ADMIN_ROLE,
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      );
    });

    test("matches the v3.1.0-ats role hashes, NOT v8.0.0-ats's — this is the exact value that caused a live deployBond revert when wrong", () => {
      assert.equal(
        ATS_ROLES.ROLE_CONTROL_LIST,
        "0xca537e1c88c9f52dc5692c96c482841c3bea25aafc5f3bfe96f645b5f800cac3",
      );
      assert.equal(
        ATS_ROLES.ROLE_CORPORATE_ACTION,
        "0x8a139eeb747b9809192ae3de1b88acfd2568c15241a5c4f85db0443a536d77d6",
      );
      assert.equal(
        ATS_ROLES.ROLE_ISSUER,
        "0x4be32e8849414d19186807008dabd451c1d87dae5f8e22f32f5ce94d486da842",
      );
      // The v8.0.0-ats value tried FIRST, which reverted — asserting it's
      // NOT what we use, so nobody "fixes" this back to it.
      assert.notEqual(
        ATS_ROLES.ROLE_ISSUER,
        "0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f",
      );
    });

    test("ROLE_CONTROL_LIST_MANAGER is _CONTROL_LIST_MANAGER_ROLE, not _CONTROL_LIST_ROLE", () => {
      // The exact bug this project shipped and then found live: these two
      // names are easy to confuse, v3.1.0-ats keeps them as genuinely
      // different roles, and only one of them gates
      // addExternalControlList/removeExternalControlList. Confirmed against
      // layer_1/constants/roles.sol directly, and against a live revert:
      // AccessControlStorageWrapper.AccountHasNoRole reverted on
      // addExternalControlList while hasRole(ROLE_CONTROL_LIST, issuer) was
      // already true, which is what exposed the mix-up.
      assert.equal(
        ATS_ROLES.ROLE_CONTROL_LIST_MANAGER,
        "0x0e625647b832ec7d4146c12550c31c065b71e0a698095568fd8320dd2aa72e75",
      );
      assert.notEqual(ATS_ROLES.ROLE_CONTROL_LIST_MANAGER, ATS_ROLES.ROLE_CONTROL_LIST);
    });

    test("all five role hashes are distinct", () => {
      const values = Object.values(ATS_ROLES);
      assert.equal(new Set(values).size, values.length);
    });
  });

  describe("RegulationType / RegulationSubType", () => {
    test("REG_D is what NameGate's demo bond actually uses (accredited-investor path)", () => {
      assert.equal(RegulationType.REG_D, 2);
      assert.equal(RegulationSubType.REG_D_506_C, 2);
    });

    test("NONE is 0 for both enums, per the Solidity enum default", () => {
      assert.equal(RegulationType.NONE, 0);
      assert.equal(RegulationSubType.NONE, 0);
    });
  });
});
