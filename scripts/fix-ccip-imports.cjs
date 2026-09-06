#!/usr/bin/env node
// @chainlink/contracts-ccip's Solidity source imports OpenZeppelin using a
// Foundry-style remapping baked directly into the import path:
//
//   import {IERC165} from "@openzeppelin/contracts@5.0.2/utils/introspection/IERC165.sol";
//
// npm cannot install a package under a name containing a literal "@version"
// — package names can't contain "@" outside of the scope prefix — so no
// ordinary `npm install` ever produces a folder at that exact path, and
// Hardhat 2 (unlike Foundry) does not read `remappings.txt`. Everyone who
// depends on @chainlink/contracts-ccip under plain Hardhat hits this; the
// standard workaround is a symlink at the literal expected path.
//
// This runs as `postinstall` so a fresh `npm install` reproduces it without
// anyone needing to know the workaround exists.

const fs = require("fs");
const path = require("path");

const ozDir = path.join(__dirname, "..", "node_modules", "@openzeppelin");
const target = "contracts"; // node_modules/@openzeppelin/contracts, installed at 5.0.2
const linkPath = path.join(ozDir, "contracts@5.0.2");

if (!fs.existsSync(path.join(ozDir, target))) {
  console.warn(
    `fix-ccip-imports: expected node_modules/@openzeppelin/${target} to exist ` +
      "(from the @openzeppelin/contracts@5.0.2 devDependency) but it does not. " +
      "Skipping — `npm run compile` will fail with HH411 if this is needed.",
  );
  process.exit(0);
}

try {
  const existing = fs.lstatSync(linkPath);
  if (existing.isSymbolicLink() && fs.readlinkSync(linkPath) === target) {
    process.exit(0); // already correct
  }
  fs.rmSync(linkPath, { recursive: true, force: true });
} catch {
  // Doesn't exist yet — nothing to remove.
}

fs.symlinkSync(target, linkPath, "dir");
console.log(`fix-ccip-imports: linked node_modules/@openzeppelin/contracts@5.0.2 -> ${target}`);
