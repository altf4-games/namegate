# NameGate frontend

A read-only-by-default dashboard that reads live compliance state straight
from Sepolia (the beacon) and Hedera testnet (the mirror, bond, and coupon
distributor), and lets a connected wallet call `publish()` and `distribute()`
itself — there is no relayer and no server in between.

## Setup

```bash
cp .env.example .env.local
```

Fill in the contract addresses (same ones the root `.env` already has) and,
to enable wallet connect and on-chain actions, a Privy app id from
[dashboard.privy.io](https://dashboard.privy.io). Without a Privy app id the
dashboard still renders real chain data — it just can't sign anything.

```bash
npm install
npm run dev
```

## Tests

- `npm test` — pure formatting/logic unit tests, no network.
- `npm run test:live` — runs the dashboard's real read functions against the
  live deployed contracts (same convention as the root project's
  `test:live:hedera`). Needs `.env.local` filled in and network access.

## Data flow

- **Reads** go straight from the browser to Sepolia and Hedera testnet RPCs
  via viem — no backend of its own.
- **Writes** (`publish`, `distribute`) go through whichever wallet is
  connected via Privy. Both contract calls are permissionless: this app
  never holds a signing key.
- ABIs for contracts in this repo (beacon, mirror, distributor) are imported
  directly from Hardhat's compiled artifacts, so they can't silently drift
  from what's actually deployed — see `src/lib/contracts.ts`.
