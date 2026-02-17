# BCH-Solana Relayer Walkthrough

## Overview
The BCH-Solana Relayer enables atomic swaps between Bitcoin Cash (Chipnet) and Solana (Devnet). This verification guide explains how to run the relayer, deploy test HTLCs, and verify the services.
**Repository**: [https://github.com/Intents-Swaps/bch-solana-relayer](https://github.com/Intents-Swaps/bch-solana-relayer)

## Prerequisites
1. **Node.js**: Installed (v18+).
2. **Funds**:
   - **BCH Chipnet**: Use a faucet (e.g. `tbch.googol.cash`) to fund the wallet generated in `.env` (or let `mainnet-js` auto-generate).
   - **Solana Devnet**: Use `solana airdrop 2` to fund the Relayer's keypair.

## 1. Build Verification
The project compile errors have been resolved. To verify the build:
```bash
cd bch-solana-relayer
npm run build
# or just check types
npx tsc --noEmit
```

## 2. Verify BCH Service (Deploy HTLC)
The `scripts/deploy-htlc.ts` script initializes the BCH wallet, funds it (if needed/possible), and deploys a test HTLC.
```bash
npx tsx scripts/deploy-htlc.ts
```
**Expected Output:**
- Wallet initialization success.
- "HTLC Deployed!" with Contract Address and TxID.
- *Note: If the wallet has 0 funds, this will fail. Fund the address shown in the output.*

## 3. Verify Solana Service
The `scripts/test-solana.ts` script initializes the Solana service and attempts to create an escrow. 
```bash
npx tsx scripts/test-solana.ts
```
**Expected Output:**
- "Solana Service Initialized".
- "Caught expected error...".
- *Note: The error confirms that the code successfully built the transaction and attempted to send it, but failed due to lack of funds (expected on fresh keypair).*

## 4. Running the Relayer
To start the relayer server:
```bash
npx tsx src/index.ts
```
The server runs on port 3000 (default).
- **Health Check**: `GET http://localhost:3000/health`
- **Active Intents**: `GET http://localhost:3000/orders`

## 5. End-to-End Test (Manual)
1. **Start Relayer**: `npx tsx src/index.ts`
2. **Deploy User HTLC**: `npx tsx scripts/deploy-htlc.ts` -> Note the `hash` and `contractAddress`.
3. **Initiate Swap**: Send a POST request to `/swap/bch-to-solana` with the details from the deployment output.
4. **Monitor**: Watch the console logs for the Relayer picking up the intent, creating the Solana escrow (`DEST_LOCKED`), and completing the flow.

## Configuration
- `.env`: Contains private keys and network settings. ensure `BCH_NETWORK=chipnet` and `SOLANA_RPC_URL=https://api.devnet.solana.com`.
