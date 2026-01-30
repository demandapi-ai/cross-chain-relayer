# Cross-Chain Relayer

## Purpose
The **Cross-Chain Relayer** is a dedicated service responsible for orchestrating atomic swaps between **Movement** and **Solana**. It acts as a trusted bridge facilitator for the current "Trusted Relayer" model (Movement -> Solana) and will eventually support fully trustless HTLC settlement.

It listens for user intents (escrow locks) on one chain and automatically:
1.  **Fills** the order effectively on the destination chain.
2.  **Claims** the funds on the source chain once the user reveals the secret on the destination chain (completing the atomic swap).

## Architecture
The relayer is built with **Fastify** and uses:
-   **Aptos SDK**: To interact with the Movement testnet.
-   **Solana Web3.js**: To interact with the Solana Devnet.

It exposes a REST API for the frontend to submit intents and for the Relayer to report its health/liquidity status.

## Interacting Contracts

The Relayer interacts with the following Hash Time Locked Contract (HTLC) deployments:

| Chain | Network | Contract Name | Address / Program ID |
| :--- | :--- | :--- | :--- |
| **Movement** | Bardock Testnet | `htlc_escrow` | `0x485ca1c12b5dfa01c282b9c7ef09fdfebbf877ed729bf999ce61a8ec5c5e69bd` |
| **Solana** | Devnet | `intent_swap` | `5nvKEjTpid3egnvQS4C2NvFk52Rh6Xu4cUxMMZbGPk4N` |

## Installation & Setup

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Environment Configuration**
    Create a `.env` file in the root of this package:
    ```env
    # Movement (Aptos) Config
    MOVEMENT_RPC_URL=https://testnet.movementnetwork.xyz/v1
    MOVEMENT_PRIVATE_KEY=0x... # Relayer's private key (must be funded with MOVE)
    MOVEMENT_HTLC_ADDRESS=0x485ca1c12b5dfa01c282b9c7ef09fdfebbf877ed729bf999ce61a8ec5c5e69bd

    # Solana Config
    SOLANA_RPC_URL=https://api.devnet.solana.com
    SOLANA_PRIVATE_KEY=...    # Base58 encoded private key (must be funded with SOL)
    SOLANA_PROGRAM_ID=5nvKEjTpid3egnvQS4C2NvFk52Rh6Xu4cUxMMZbGPk4N
    
    # Server Port
    PORT=3003
    ```

3.  **Run Locally (Development)**
    ```bash
    npm run dev
    ```

4.  **Build & Run (Production)**
    ```bash
    npm run build
    npm start
    ```

## API Endpoints

-   `GET /health`: Returns relayer balances and connection status.
-   `GET /orders`: Returns detailed history of active and completed swap intents.
-   `POST /swap/movement-to-solana`: Receives a request to lock MOVE on Movement (Frontend triggers this).
-   `POST /swap/solana-to-movement`: Receives a request to lock SOL on Solana.
-   `POST /reveal-secret`: Used to submit the secret for the `MOV -> SOL` flow (Trusted Mode claim).

## Deployment

To deploy this service (e.g., to Railway, AWS, or a VPS):

1.  Ensure the environment variables are set in your deployment provider.
2.  Use the `start` command (`npm start`).
3.  Expose port `3003` (or the port defined in your env).

### Docker Support (Optional)
A standard Node.js Dockerfile can be used:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "start"]
```
