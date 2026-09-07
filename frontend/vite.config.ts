import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// server.fs.allow reaches up into the repo's compiled artifacts directory —
// the mirror and coupon-distributor ABIs are imported directly from
// Hardhat's build output (see src/lib/contracts.ts) rather than
// hand-transcribed, so they can never silently drift from what's actually
// deployed. Same reasoning as ens/src/beacon.ts's artifact loader, just on
// the browser side instead of Node's.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [".."],
    },
  },
});
