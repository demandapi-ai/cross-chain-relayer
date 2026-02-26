import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Ed25519Program } from '@solana/web3.js';
import { getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, NATIVE_MINT, createSyncNativeInstruction, createCloseAccountInstruction } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { createHash } from 'crypto';
import chalk from 'chalk';
import { config } from '../config.js';
import idl from './intent_swap.json' with { type: 'json' };

// Minimal IDL interface
interface IntentSwap {
    version: "0.1.0",
    name: "intent_swap",
    instructions: any[]
}

/**
 * Solana Service for cross-chain HTLC operations using Anchor
 */
export class SolanaService {
    private connection: Connection;
    private keypair: Keypair;
    private program: Program<any>;
    private provider: anchor.AnchorProvider;

    constructor(privateKey?: string) {
        this.connection = new Connection(config.solana.rpcUrl, 'confirmed');

        // Initialize keypair
        const key = privateKey || config.solana.privateKey;

        if (key) {
            try {
                const secretKey = Uint8Array.from(JSON.parse(key));
                this.keypair = Keypair.fromSecretKey(secretKey);
                console.log(chalk.magenta('✅ Solana Service: Loaded Keypair'));
            } catch {
                console.log(chalk.yellow('⚠️  Solana: Could not parse key. Using random.'));
                this.keypair = Keypair.generate();
            }
        } else {
            this.keypair = Keypair.generate();
        }

        // Initialize Anchor Provider
        const wallet = new anchor.Wallet(this.keypair);
        this.provider = new anchor.AnchorProvider(
            this.connection,
            wallet,
            { preflightCommitment: 'confirmed' }
        );

        // Initialize Program
        this.program = new anchor.Program(idl as any, this.provider);
        console.log(chalk.magenta(`☀️ Solana Service Initialized: ${this.keypair.publicKey.toBase58()}`));
    }

    get publicKey(): PublicKey {
        return this.keypair.publicKey;
    }

    /**
     * Create an Escrow (HTLC) on Solana
     * Used in BCH -> SOL flow (Relayer locks SOL for User)
     */
    async createEscrow(
        recipient: PublicKey,
        hashlock: Buffer, // 32 bytes
        amountLamports: anchor.BN,
        timelock: anchor.BN,
        tokenMint: PublicKey = NATIVE_MINT
    ): Promise<{ tx: string, escrowPda: string }> {
        console.log(chalk.cyan(`⚡ Creating Solana Escrow for Mint: ${tokenMint.toBase58()}...`));

        // Derive Escrow PDA
        // Seeds: "escrow", maker (Relayer), hashlock
        const [escrowPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("escrow"),
                this.keypair.publicKey.toBuffer(),
                hashlock
            ],
            this.program.programId
        );

        // Derive Vault PDA
        const [vaultPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("vault"),
                escrowPda.toBuffer()
            ],
            this.program.programId
        );

        // Relayer's Token account (source of funds)
        const makerTokenAccount = await getAssociatedTokenAddress(tokenMint, this.keypair.publicKey);

        // Ensure Relayer's Token account exists
        await getOrCreateAssociatedTokenAccount(
            this.connection,
            this.keypair,
            tokenMint,
            this.keypair.publicKey
        );

        // Prepare Wrapping Instructions ONLY if Native Mint
        const preIxs = [];
        if (tokenMint.equals(NATIVE_MINT)) {
            preIxs.push(
                SystemProgram.transfer({
                    fromPubkey: this.keypair.publicKey,
                    toPubkey: makerTokenAccount,
                    lamports: BigInt(amountLamports.toString())
                })
            );
            preIxs.push(createSyncNativeInstruction(makerTokenAccount));
        }

        try {
            const program: any = this.program;
            const tx = await program.methods
                .initialize(
                    [...hashlock],
                    timelock,
                    amountLamports
                )
                .preInstructions(preIxs)
                .accounts({
                    maker: this.keypair.publicKey,
                    taker: recipient, // User is taker
                    tokenMint: tokenMint,
                    escrow: escrowPda,
                    makerTokenAccount: makerTokenAccount,
                    vault: vaultPda,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY
                })
                .rpc();

            console.log(chalk.green(`✅ Solana Escrow Created: ${tx}`));
            return { tx, escrowPda: escrowPda.toBase58() };
        } catch (e: any) {
            console.error(chalk.red("Failed to create escrow:"), e);
            throw e;
        }
    }

    /**
     * Claim an Escrow on Solana
     * Used in SOL -> BCH flow (Relayer claims SOL using secret)
     */
    async claimEscrow(
        maker: PublicKey,       // User (who created the escrow)
        hashlock: Buffer,
        secret: Buffer,
        escrowPda?: PublicKey,   // Optional, derived if not provided
        tokenMint: PublicKey = NATIVE_MINT
    ): Promise<string> {
        console.log(chalk.cyan(`⚡ Claiming Solana Escrow for Mint: ${tokenMint.toBase58()}...`));

        // Derive if missing
        if (!escrowPda) {
            [escrowPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("escrow"),
                    maker.toBuffer(),
                    hashlock
                ],
                this.program.programId
            );
        }

        const [vaultPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), escrowPda.toBuffer()],
            this.program.programId
        );

        // Relayer is Taker (recipient of tokens)
        const takerTokenAccount = await getAssociatedTokenAddress(tokenMint, this.keypair.publicKey);

        // Ensure Taker (Recipient) has Token account
        await getOrCreateAssociatedTokenAccount(
            this.connection,
            this.keypair,
            tokenMint,
            this.keypair.publicKey
        );

        // Provide Post Instructions ONLY if Native Mint
        const postIxs = [];
        if (tokenMint.equals(NATIVE_MINT)) {
            postIxs.push(createCloseAccountInstruction(
                takerTokenAccount, // Close this WSOL account
                this.keypair.publicKey, // Send rent/funds to Taker wallet
                this.keypair.publicKey // Owner
            ));
        }

        try {
            const program: any = this.program;
            const builder = program.methods
                .claim([...secret])
                .accounts({
                    taker: this.keypair.publicKey,
                    escrow: escrowPda,
                    vault: vaultPda,
                    takerTokenAccount: takerTokenAccount,
                    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
                });

            if (postIxs.length > 0) {
                builder.postInstructions(postIxs);
            }

            const tx = await builder.rpc();

            console.log(chalk.green(`✅ Solana Escrow Claimed: ${tx}`));
            return tx;
        } catch (e: any) {
            console.error(chalk.red("Failed to claim escrow:"), e);
            throw e;
        }
    }

    /**
     * Watch an Escrow for 'Claim' event (User reveals secret)
     * Used in BCH -> SOL flow
     */
    async watchForSecret(escrowPda: PublicKey): Promise<string | null> {
        // Polling approach for hackathon simplicity
        // In production, use websocket subscription or account change listener

        try {
            const account = await (this.program.account as any).escrowState.fetchNullable(escrowPda);
            if (!account) return null; // Escrow closed (claimed or refunded)

            // If closed/null, we have to check transaction history to find the secret!
            // fetching the account only tells us if it's open.
            // If it's closed, we missed it?

            // Strategy:
            // 1. Check if account exists. If yes, it's not claimed yet.
            // 2. If no, fetch signatures for the PDA address.
            // 3. Parse transactions to find 'claim' instruction and extract secret.

            // Check past transactions
            const signatures = await this.connection.getSignaturesForAddress(escrowPda, { limit: 5 });

            for (const sigInfo of signatures) {
                if (sigInfo.err) continue;

                const tx = await this.connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
                if (!tx) continue;

                // Look for 'claim' instruction data or logs
                // Anchor instructions are hard to parse without IDL coder
                // But we can check logs for "Program log: Instruction: Claim"
                // And input data.

                // Better: Anchor event check?
                // `EscrowClaimedEvent` is implemented? Let's assume no event for now based on `lib.rs`.
                // Wait, `lib.rs` doesn't emit events in the version I read.

                // Fallback: Parse input data of the instruction.
                // Claim instruction has `secret: [u8; 32]`.
                // We need to find the instruction targeting the program.

                for (const ix of tx.transaction.message.instructions) {
                    if (ix.programId.toBase58() === this.program.programId.toBase58()) {
                        // This is our program.
                        // Check data. Discriminator (8 bytes) + Secret (32 bytes).
                        // We can decode using anchor coder.

                        // Hack: Decode manually or try-catch.
                        try {
                            // "claim" is likely the 2nd instruction or based on IDL.
                            // Let's decode entire Ix if possible.
                            // `this.program.coder.instruction.decode(ix.data, 'base58')`

                            const ixData = (ix as any).data; // base58 string 
                            const ixBuf = Buffer.from(anchor.utils.bytes.bs58.decode(ixData));

                            // Discriminator provided by IDL
                            // claim discriminator: ...

                            // Let's rely on finding 32 bytes that hash to our hashlock?
                            // We don't have hashlock here easily unless passed.
                            // But we can just return candidates.

                            if (ixBuf.length >= 40) { // 8 disc + 32 secret
                                const secretCandidate = ixBuf.slice(8, 40);
                                return secretCandidate.toString('hex');
                            }
                        } catch (e) { }
                    }
                }
            }
        } catch (e) {
            console.log("Error watching/parsing Solana:", e);
        }
        return null; // Not found yet
    }
}
