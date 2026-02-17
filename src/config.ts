import dotenv from 'dotenv';
dotenv.config();

export const config = {
    // BCH (Chipnet)
    bch: {
        network: 'chipnet',
        walletPath: process.env.BCH_WALLET_PATH || '../contracts-bch-swap/wallet.json',
        // Contract Artifact Path
        artifactPath: '../contracts-bch-crosschain/artifacts/CrossChainHTLC.json'
    },

    // Solana (Devnet)
    solana: {
        rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        privateKey: process.env.SOLANA_PRIVATE_KEY || '',
        programId: '5JAWumq5L4B8WrpF3CFox36SZ2bJF4xQvskLksmHRgs2',
    },

    // Server
    port: parseInt(process.env.PORT || '3004'),

    // Timelocks (seconds)
    timelocks: {
        source: parseInt(process.env.SOURCE_TIMELOCK || '7200'),  // 2 hours
        dest: parseInt(process.env.DEST_TIMELOCK || '3600'),      // 1 hour
    },

    // Polling
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000'),
};
