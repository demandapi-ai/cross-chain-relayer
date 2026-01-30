import dotenv from 'dotenv';
dotenv.config();

export const config = {
    // Movement (Aptos-based)
    movement: {
        rpcUrl: process.env.MOVEMENT_RPC_URL || 'https://testnet.movementnetwork.xyz/v1',
        privateKey: process.env.MOVEMENT_PRIVATE_KEY || '',
        htlcAddress: process.env.MOVEMENT_HTLC_ADDRESS || '0x485ca1c12b5dfa01c282b9c7ef09fdfebbf877ed729bf999ce61a8ec5c5e69bd',
    },

    // Solana
    solana: {
        rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        privateKey: process.env.SOLANA_PRIVATE_KEY || '',
        programId: process.env.SOLANA_PROGRAM_ID || '5nvKEjTpid3egnvQS4C2NvFk52Rh6Xu4cUxMMZbGPk4N',
    },

    // Server
    port: parseInt(process.env.PORT || '3003'),

    // Timelock defaults (in seconds)
    timelocks: {
        movement: 3600,  // 1 hour for Movement (destination gets shorter timelock)
        solana: 7200,    // 2 hours for Solana (source gets longer timelock)
    },
};

// Token configurations
export const TOKENS = {
    movement: {
        MOVE: '0x1::aptos_coin::AptosCoin',
        USDC: '0x45142fb00dde90b950183d8ac2815597892f665c254c3f42b5768bc6ae4c8489',
    },
    solana: {
        SOL: '11111111111111111111111111111111', // Native SOL placeholder
        USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Devnet USDC
    },
};
