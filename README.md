# Cross-Chain Relayer (Movement ↔ Solana)

This package acts as the bridge between the **Movement** and **Solana** blockchains for the Intent Protocol. It listens for intent events, verifies signatures, and executes atomic swaps using HTLCs (Hash Time Locked Contracts).

## 🚀 Features
- **Atomic Swaps:** Secure cross-chain exchanges using HTLC.
- **Bi-Directional:** Supports Movement → Solana and Solana → Movement.
- **Relayer API:** REST API for submitting intentions and checking status.
- **Automated Fulfillment:** Listens for events and auto-fills orders.

## 🛠️ Setup

### Prerequisites
- Node.js v18+
- Solana CLI
- Aptos CLI (for Movement)

### 1. Installation
```bash
cd packages/cross-chain-relayer
npm install
```

### 2. Configuration
Create a `.env` file based on `.env.example`:

```env
PORT=3003
RELAYER_PRIVATE_KEY=...    # Movement Private Key (0x...)
SOLANA_PRIVATE_KEY=...     # Solana Private Key Array ([1,2,3...])
MOVEMENT_RPC_URL=https://testnet.movementnetwork.xyz/v1
SOLANA_RPC_URL=https://api.devnet.solana.com
```

### 3. Funding
The relayer needs funds on both chains to execute transactions.

**Fund Solana (WSOL):**
The relayer uses Wrapped SOL (WSOL) for swaps.
```bash
npm run fund:wsol
```

**Fund Movement:**
Use the Movement faucet or transfer MOVE tokens to the relayer address printed on startup.

### 4. Running the Relayer
```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## 📚 API Endpoints

### Health Check
`GET /health`
Returns the status of the relayer and connected chains.

### Submit Swap (Movement → Solana)
`POST /swap/movement-to-solana`
```json
{
  "makerAddress": "0x...",
  "recipientAddress": "SolanaAddress...",
  "sellAmount": "100000000",
  "buyAmount": "1000000000",
  "hashlock": "0x...",
  "signature": "..." 
}
```

### Submit Swap (Solana → Movement)
`POST /swap/solana-to-movement`
```json
{
  "makerAddress": "SolanaAddress...",
  "recipientAddress": "0x...",
  "sellAmount": "1000000000",
  "buyAmount": "100000000",
  "hashlock": "0x..."
}
```

## 🧪 Testing

Run End-to-End tests:
```bash
npm run test:e2e
```
