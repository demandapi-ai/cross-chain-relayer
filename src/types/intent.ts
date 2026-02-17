export interface CrossChainIntent {
    // Unique identifier
    id: string;

    // Direction
    direction: 'BCH_TO_SOL' | 'SOL_TO_BCH';

    // Addresses
    makerAddress: string;      // User's address on source chain
    takerAddress: string;      // Relayer's address (fills on dest chain)
    recipientAddress: string;  // User's address on destination chain

    // Tokens/Amounts
    sellAmount: string;        // Amount user locks on source
    buyAmount: string;         // Amount user receives on dest

    // HTLC Parameters
    hashlock: string;          // Hex encoded SHA-256 hash (32 bytes)
    secret?: string;           // Hex encoded preimage (32 bytes)

    // Timelocks (Unix timestamps)
    sourceTimelock: number;
    destTimelock: number;

    // Chain-Specific Identifiers
    bchContractAddress?: string;  // Address of the specific CrossChainHTLC covenant
    solanaEscrowPda?: string;     // PDA of the Solana escrow account

    // Transaction Hashes
    sourceLockTx?: string;     // User locks funds
    destFillTx?: string;       // Relayer fills dest
    sourceClaimTx?: string;    // Relayer claims source (reveals secret)
    destClaimTx?: string;      // User claims dest (reveals secret)
    refundTx?: string;         // Refund transaction if expired

    // Status Tracking
    status: IntentStatus;
    createdAt: number;
    updatedAt: number;
}

export type IntentStatus =
    | 'PENDING'           // Intent received
    | 'SOURCE_LOCKED'     // User locked funds on source
    | 'DEST_FILLED'       // Relayer filled on destination
    | 'DEST_CLAIMED'      // User claimed on destination (secret revealed)
    | 'SOURCE_CLAIMED'    // Relayer claimed on source
    | 'COMPLETED'         // Swap finished
    | 'REFUNDED'          // Timelock expired, funds returned
    | 'FAILED';           // Error
