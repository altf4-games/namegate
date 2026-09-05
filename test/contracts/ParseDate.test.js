// Hardhat/mocha contract tests. Run with: npm run test:contracts
//
// parseDate is the riskiest code in the beacon: hand-rolled date arithmetic
// in Solidity, deciding whether someone is allowed to move a security. It
// gets tested harder than anything else here.
//
// Three angles:
//   1. Known-correct fixtures, computed with Date.UTC rather than by hand.
//   2. A differential sweep against JavaScript across thousands of dates,
//      which is what actually catches leap-year and month-boundary errors.
//   3. Malformed input, which must fail CLOSED (max uint64), never to 0.
//
// The fail-closed direction matters more than it looks: 0 means "no lockup"
// and would authorize the holder. A parser that returns 0 on garbage turns a
// typo in a compliance record into an authorization.

import { expect } from "chai";
import hre from "hardhat";

const MAX_UINT64 = 2n ** 64n - 1n;

// Deployed once; parseDate is pure so no test can affect another.
let beacon;

before(async function () {
  const [, , stranger] = await hre.ethers.getSigners();
  const registry = await hre.ethers.deployContract("FakeEnsRegistry");
  const router = await hre.ethers.deployContract("FakeCcipRouter", [0]);
  beacon = await hre.ethers.deployContract("ENSComplianceBeacon", [
    await registry.getAddress(),
    hre.ethers.namehash("namegate.eth"),
    await router.getAddress(),
    222782988166878823n,
    stranger.address,
  ]);
});

function expectedSeconds(y, m, d) {
  return BigInt(Date.UTC(y, m - 1, d) / 1000);
}

describe("ENSComplianceBeacon.parseDate", function () {
  describe("valid dates", function () {
    it("parses the Unix epoch", async function () {
      expect(await beacon.parseDate("1970-01-01")).to.equal(0n);
    });

    it("parses dates this project actually uses", async function () {
      expect(await beacon.parseDate("2026-12-31")).to.equal(expectedSeconds(2026, 12, 31));
      expect(await beacon.parseDate("2027-03-01")).to.equal(expectedSeconds(2027, 3, 1));
    });

    it("handles leap day in a leap year", async function () {
      expect(await beacon.parseDate("2028-02-29")).to.equal(expectedSeconds(2028, 2, 29));
    });

    it("handles the year-2000 rule (divisible by 400 is a leap year)", async function () {
      expect(await beacon.parseDate("2000-02-29")).to.equal(expectedSeconds(2000, 2, 29));
    });

    it("handles month boundaries either side of March", async function () {
      // The civil-days algorithm shifts the year for Jan/Feb, so these are
      // the cases most likely to be off by a year.
      for (const [y, m, d] of [
        [2026, 1, 1],
        [2026, 2, 28],
        [2026, 3, 1],
        [2026, 12, 31],
        [2027, 1, 1],
      ]) {
        const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        expect(await beacon.parseDate(iso), iso).to.equal(expectedSeconds(y, m, d));
      }
    });

    it("returns midnight UTC, not local midnight", async function () {
      const value = await beacon.parseDate("2026-06-15");
      expect(value % 86400n).to.equal(0n);
      expect(value).to.equal(expectedSeconds(2026, 6, 15));
    });
  });

  describe("differential sweep against JavaScript", function () {
    it("agrees with Date.UTC on the 1st and 28th of every month, 1970-2100", async function () {
      // ~3100 dates. Slow-ish but this is the test that would actually catch
      // a leap-year or era-boundary mistake.
      this.timeout(120_000);
      const calls = [];
      for (let y = 1970; y <= 2100; y += 1) {
        for (let m = 1; m <= 12; m += 1) {
          for (const d of [1, 28]) {
            const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            calls.push([iso, expectedSeconds(y, m, d)]);
          }
        }
      }
      const results = await Promise.all(calls.map(([iso]) => beacon.parseDate(iso)));
      for (let i = 0; i < calls.length; i += 1) {
        expect(results[i], calls[i][0]).to.equal(calls[i][1]);
      }
    });

    it("agrees with Date.UTC on every last-day-of-February from 1996 to 2036", async function () {
      this.timeout(60_000);
      for (let y = 1996; y <= 2036; y += 1) {
        const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        const d = leap ? 29 : 28;
        const iso = `${y}-02-${d}`;
        expect(await beacon.parseDate(iso), iso).to.equal(expectedSeconds(y, 2, d));
      }
    });
  });

  describe("empty means no date set", function () {
    it("returns 0 for an empty string", async function () {
      expect(await beacon.parseDate("")).to.equal(0n);
    });
  });

  describe("malformed input fails closed", function () {
    const bad = [
      ["wrong separator", "2026/12/31"],
      ["US ordering", "12-31-2026"],
      ["unpadded month and day", "2026-1-1"],
      ["too short", "2026-12-3"],
      ["too long", "2026-12-311"],
      ["trailing space", "2026-12-31 "],
      ["leading space", " 2026-12-31"],
      ["letters in the year", "20x6-12-31"],
      ["letters in the day", "2026-12-3x"],
      ["all letters", "not-a-date"],
      ["month zero", "2026-00-15"],
      ["month thirteen", "2026-13-01"],
      ["day zero", "2026-12-00"],
      ["day 32", "2026-12-32"],
      ["31st of a 30-day month", "2026-11-31"],
      ["Feb 30", "2027-02-30"],
      ["Feb 29 in a non-leap year", "2027-02-29"],
      ["Feb 29 in a century non-leap year", "1900-02-29"],
      ["before 1970", "1969-12-31"],
      ["a plain number", "1798675200"],
    ];

    for (const [why, value] of bad) {
      it(`rejects ${why}: "${value}"`, async function () {
        expect(await beacon.parseDate(value)).to.equal(MAX_UINT64);
      });
    }

    it("never returns 0 for malformed input, since 0 would mean 'no lockup'", async function () {
      for (const [, value] of bad) {
        expect(await beacon.parseDate(value), value).to.not.equal(0n);
      }
    });
  });
});
