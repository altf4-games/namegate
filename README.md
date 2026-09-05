# NameGate

**ENS names as the compliance layer for a tokenized bond.**

An investor holds an ENS subname — `investora.namegate.eth` — on ENSv2/Sepolia. Their KYC status, jurisdiction, accreditation expiry and lock-up live on that name. A tokenized bond on Hedera, issued with Asset Tokenization Studio, reads that state before it will move a token or pay a coupon.

The investor owns the name. The issuer owns exactly one key on it. Neither can impersonate the other.

> **Status: pre-implementation.** Research and design are complete and committed; contracts are not yet written. Built for [ETHOnline 2026](https://ethglobal.com/events/ethonline2026) (4–13 Sept 2026).

---

## The idea in one diagram

```
 investora.namegate.eth                                   ATS Bond (Hedera)
 ┌────────────────────────┐                              ┌──────────────────┐
 │ compliance.kyc         │   permissionless beacon      │ isAbleToAccess() │
 │ compliance.jurisdiction│──── reads on-chain, ────────▶│   AND external   │
 │ compliance.accred-exp  │     ships over CCIP          │   control list   │
 │ compliance.lockup-until│                              └──────────────────┘
 └────────────────────────┘                                       │
   ▲ only the KYC provider can write this key                     ▼
   │ (authorizeTextRoles)                              transfer / coupon payment
   │ investor cannot repoint the resolver
   │ (ROLE_SET_RESOLVER withheld)
```

**There is no trusted relayer.** A contract on Sepolia calls `resolver.text(...)` on-chain in the same transaction that emits the CCIP message, and anyone can trigger it. The relayer role collapses from "oracle" to "whoever pays the gas."

---

## Why ENS, honestly

Compliance data living outside the token is not new — [ERC-3643](https://eips.ethereum.org/EIPS/eip-3643) is Final, ONCHAINID already does expiring revocable claims, and Hedera integrated ERC-3643 into ATS in November 2025. NameGate does not compete with that stack; it **plugs into it**, shipping as an `IExternalControlList` provider inside ATS's own extension point.

What changes is the identity substrate: a human-readable, user-held, hierarchically-delegated name instead of an opaque identity contract address. `investora.namegate.eth` is legible to a compliance officer, and its permission structure is inspectable by anyone.

The honest gap is against Hedera's **native** KYC, which is a single per-account bit — no jurisdiction, no expiry, no issuer attribution, set irreversibly at token creation.

---

## ENSv2 features used

Compliance properties are ENSv2 primitives, not strings parsed out of records:

| Compliance property | ENSv2 mechanism |
|---|---|
| Only the KYC provider may set KYC status | `authorizeTextRoles` — Enhanced Access Control, scoped to one key |
| Accreditation expires | Subname expiry — the name itself expires |
| Investor cannot forge their own status | `ROLE_SET_RESOLVER` withheld; subname points at the issuer's Permissioned Resolver |
| Investor cannot sell their allocation | Non-transferable subname |
| Issuer namespace | Own `UserRegistry` subregistry under `namegate.eth` |

---

## Stack

| Layer | Choice |
|---|---|
| Identity | ENSv2 on Ethereum Sepolia — Permissioned Resolver, Enhanced Access Control, custom subname registry |
| Security token | Hedera Asset Tokenization Studio (ERC-3643 / ERC-1400 bond, native coupons) |
| Cross-chain | Chainlink CCIP v1.6.0, Sepolia → Hedera Testnet |
| Wallets | Privy — organization wallet + policy controls |
| Client | viem ≥ 2.35.0 |

---

## Repository

Architecture, addresses, and interface details are documented inline in the contracts.

---

## Known limitations

Stated up front rather than discovered by a judge:

- **CCIP delivery takes minutes** (documented "several"; the reference demo says 10–20). An EIP-712 k-of-n attestation path writes to the same storage slot as a live fallback.
- **Trust is not eliminated, it is narrowed** — CCIP is trusted for delivery and ordering, never for content.
- **Mirrored state can be stale.** Records carry a source block and observation timestamp, and expire against a `maxStaleness` window rather than persisting indefinitely.
- **ENSv2 is beta.** Contracts were under Immunefi audit through 2026-09-14; addresses may move.

---

## 🤖 Use of AI

AI tools played a helpful role in building NameGate, from researching the ENSv2 and Hedera ATS integration paths to drafting documentation and assisting with contract structure.

## License

Apache-2.0 (matching Asset Tokenization Studio).
