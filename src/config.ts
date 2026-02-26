import dotenv from 'dotenv';
dotenv.config();

export const config = {
    // BCH (Chipnet)
    bch: {
        network: 'chipnet',
        privateKey: process.env.BCH_PRIVATE_KEY_WIF,
        walletPath: process.env.BCH_WALLET_PATH || '../contracts-bch-swap/wallet.json',
        // Contract Artifact Path
        artifactPath: '../contracts-bch-crosschain/artifacts/CrossChainHTLC.json'
    },

    // Solana (Devnet)
    solana: {
        rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        privateKey: process.env.SOLANA_PRIVATE_KEY || '',
        programId: '5JAWumq5L4B8WrpF3CFox36SZ2bJF4xQvskLksmHRgs2', // Ensure correct relayer program ID 
    },

    // Movement (Testnet)
    movement: {
        rpcUrl: process.env.MOVEMENT_RPC_URL || 'https://testnet.movementnetwork.xyz/v1',
        privateKey: process.env.MOVEMENT_PRIVATE_KEY || '',
        htlcAddress: process.env.MOVEMENT_HTLC_ADDRESS || '0x485ca1c12b5dfa01c282b9c7ef09fdfebbf877ed729bf999ce61a8ec5c5e69bd',
    },

    // Server
    port: parseInt(process.env.PORT || '3004'),

    // Timelocks (seconds)
    timelocks: {
        source: parseInt(process.env.SOURCE_TIMELOCK || '7200'),  // 2 hours
        dest: parseInt(process.env.DEST_TIMELOCK || '3600'),      // 1 hour
        movement: parseInt(process.env.DEST_TIMELOCK || '3600'),  // 1 hour
        solana: parseInt(process.env.SOURCE_TIMELOCK || '7200'),  // 2 hours
    },

    // Polling
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000'),
};

// Token configurations
export const TOKENS = {
    movement: {
        MOVE: '0x1::aptos_coin::AptosCoin',
        USDC: '0x45142fb00dde90b950183d8ac2815597892f665c254c3f42b5768bc6ae4c8489',
    },
    solana: {
        SOL: '11111111111111111111111111111111',
        USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Devnet USDC
        USDT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Devnet placeholder 
    },
};
