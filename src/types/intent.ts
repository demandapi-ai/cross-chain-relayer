export interface CrossChainIntent {
    // Unique identifier
    id: string;

    // Direction: 'MOV_TO_SOL' or 'SOL_TO_MOV'
    direction: 'MOV_TO_SOL' | 'SOL_TO_MOV';

    // Addresses
    makerAddress: string;      // User's address on source chain
    takerAddress: string;      // Relayer's address (fills on dest chain)
    recipientAddress: string;  // User's address on destination chain

    // Tokens
    sellToken: string;         // Token type/mint on source chain
    buyToken: string;          // Token type/mint on dest chain

    // Amounts (in smallest units)
    sellAmount: string;
    buyAmount: string;

    // HTLC
    hashlock: string;          // Hex encoded SHA-256 hash
    secret?: string;           // Hex encoded preimage (only known to maker initially)

    // Timelocks (Unix timestamps)
    sourceTimelock: number;
    destTimelock: number;

    // Escrow IDs
    sourceEscrowId?: string;   // ID on source chain
    destEscrowId?: string;     // ID on dest chain

    // Status
    status: IntentStatus;
    createdAt: number;
    updatedAt: number;

    // Transaction hashes
    sourceLockTx?: string;
    destFillTx?: string;
    sourceClaimTx?: string;
    destClaimTx?: string;
}

export type IntentStatus =
    | 'PENDING'           // Intent received, not yet processed
    | 'SOURCE_LOCKED'     // User locked funds on source chain
    | 'DEST_FILLED'       // Relayer filled on destination chain
    | 'DEST_CLAIMED'      // User claimed on destination (revealed secret)
    | 'SOURCE_CLAIMED'    // Relayer claimed on source (using revealed secret)
    | 'COMPLETED'         // Both sides settled
    | 'REFUNDED'          // Timelock expired, funds refunded
    | 'FAILED';           // Error occurred

export interface ChainBalance {
    symbol: string;
    balance: number;
    decimals: number;
}

export interface RelayerHealth {
    movement: {
        address: string;
        balances: ChainBalance[];
        connected: boolean;
    };
    solana: {
        address: string;
        balances: ChainBalance[];
        connected: boolean;
    };
}
