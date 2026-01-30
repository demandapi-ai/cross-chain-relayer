import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { createHash } from 'crypto';
import chalk from 'chalk';
import { config, TOKENS } from '../config';
import { ChainBalance } from '../types/intent';

/**
 * Solana Service for cross-chain HTLC operations
 * Uses direct web3.js transactions instead of Anchor for simplicity
 */
export class SolanaService {
    private connection: Connection;
    private keypair: Keypair;
    private programId: PublicKey;

    constructor() {
        this.connection = new Connection(config.solana.rpcUrl, 'confirmed');
        this.programId = new PublicKey(config.solana.programId);

        // Initialize keypair
        if (config.solana.privateKey) {
            try {
                const secretKey = Uint8Array.from(JSON.parse(config.solana.privateKey));
                this.keypair = Keypair.fromSecretKey(secretKey);
                console.log(chalk.green('✅ Loaded SOLANA_PRIVATE_KEY'));
            } catch {
                console.log(chalk.yellow('⚠️  Could not parse SOLANA_PRIVATE_KEY. Using random.'));
                this.keypair = Keypair.generate();
            }
        } else {
            console.log(chalk.yellow('⚠️  No SOLANA_PRIVATE_KEY set. Using ephemeral account.'));
            this.keypair = Keypair.generate();
        }

        console.log(chalk.magenta(`☀️ Solana Service Initialized: ${this.keypair.publicKey.toBase58()}`));
    }

    /**
     * Get the PDA for an escrow
     */
    getEscrowPda(maker: PublicKey, hashlock: Uint8Array): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('escrow'), maker.toBuffer(), Buffer.from(hashlock)],
            this.programId
        );
    }

    /**
     * Get the vault PDA
     */
    getVaultPda(escrowPda: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('vault'), escrowPda.toBuffer()],
            this.programId
        );
    }

    /**
     * Transfer SOL directly (simplified version for testing)
     * In production, this would interact with the HTLC program
     */
    async transferSol(
        recipient: PublicKey,
        amount: number // in lamports
    ): Promise<string> {
        console.log(chalk.cyan(`💸 Transferring ${amount / LAMPORTS_PER_SOL} SOL to ${recipient.toBase58().slice(0, 10)}...`));

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: this.keypair.publicKey,
                toPubkey: recipient,
                lamports: amount,
            })
        );

        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.keypair]
        );

        console.log(chalk.green(`✅ SOL Transfer: ${signature}`));
        return signature;
    }

    /**
     * Get SOL balance
     */
    async getBalances(): Promise<ChainBalance[]> {
        const balances: ChainBalance[] = [];

        try {
            const solBalance = await this.connection.getBalance(this.keypair.publicKey);
            balances.push({
                symbol: 'SOL',
                balance: solBalance / LAMPORTS_PER_SOL,
                decimals: 9,
            });
        } catch (e) {
            console.error('Failed to get Solana balances:', e);
        }

        return balances;
    }

    get publicKey(): PublicKey {
        return this.keypair.publicKey;
    }

    /**
     * Generate hashlock from secret (SHA-256)
     */
    static generateHashlock(secret: Uint8Array): Uint8Array {
        return createHash('sha256').update(Buffer.from(secret)).digest();
    }

    /**
     * Generate random 32-byte secret
     */
    static generateSecret(): Uint8Array {
        const secret = new Uint8Array(32);
        crypto.getRandomValues(secret);
        return secret;
    }
}
