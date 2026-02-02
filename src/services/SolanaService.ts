import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Ed25519Program } from '@solana/web3.js';
import { getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, NATIVE_MINT } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { Program, Idl } from '@coral-xyz/anchor';
import { createHash } from 'crypto';
import chalk from 'chalk';
import { config, TOKENS } from '../config';
import { ChainBalance } from '../types/intent';
import idl from '../intent_swap.json';

/**
 * Solana Service for cross-chain HTLC operations using Anchor
 */
export class SolanaService {
    private connection: Connection;
    private keypair: Keypair;
    private program: Program;
    private provider: anchor.AnchorProvider;

    constructor() {
        this.connection = new Connection(config.solana.rpcUrl, 'confirmed');

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

    /**
     * Call the 'fill' instruction on the smart contract
     */
    async fill(
        maker: PublicKey,
        sellAmount: anchor.BN,
        buyAmount: anchor.BN,
        intentParams: any,
        signatureArr: number[]
    ): Promise<{ tx: string, escrowPda: string }> {
        console.log(chalk.cyan(`⚡ Calling 'fill' on Solana contract...`));
        try {
            require('fs').appendFileSync('debug_relayer.log', `[${new Date().toISOString()}] Calling fill with intentParams: ${JSON.stringify(intentParams, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}\n`);
            require('fs').appendFileSync('debug_relayer.log', `[${new Date().toISOString()}] Signature len: ${signatureArr.length}\n`);
            require('fs').appendFileSync('debug_relayer.log', `[${new Date().toISOString()}] Maker: ${maker.toBase58()}\n`);

            // Log verified parameters
            console.log(chalk.gray(`   [DEBUG CHECK] StartTime: ${intentParams.start_time.toString()}, EndTime: ${intentParams.end_time.toString()}`));
            console.log(chalk.gray(`   [DEBUG CHECK] StartAmt: ${intentParams.start_amount.toString()}, EndAmt: ${intentParams.end_amount.toString()}`));
            console.log(chalk.gray(`   [DEBUG CHECK] SellAmt: ${intentParams.sell_amount.toString()}`));
        } catch (e) { }

        // Use provided signature
        const signature = signatureArr;

        // ==== MANUAL BORSH SERIALIZATION (bypasses Anchor coder version issues) ====
        // Intent struct layout: 3 Pubkeys (32 bytes each) + 6 u64/i64 values (8 bytes each) = 144 bytes
        let message: Buffer;
        try {
            message = Buffer.alloc(144);
            let offset = 0;

            // Write Pubkeys (32 bytes each)
            intentParams.maker.toBuffer().copy(message, offset); offset += 32;
            intentParams.sell_token.toBuffer().copy(message, offset); offset += 32;
            intentParams.buy_token.toBuffer().copy(message, offset); offset += 32;

            // Write u64/i64 values (8 bytes each, little-endian)
            message.writeBigUInt64LE(BigInt(intentParams.sell_amount.toString()), offset); offset += 8;
            message.writeBigUInt64LE(BigInt(intentParams.start_amount.toString()), offset); offset += 8;
            message.writeBigUInt64LE(BigInt(intentParams.end_amount.toString()), offset); offset += 8;
            message.writeBigInt64LE(BigInt(intentParams.start_time.toString()), offset); offset += 8;
            message.writeBigInt64LE(BigInt(intentParams.end_time.toString()), offset); offset += 8;
            message.writeBigUInt64LE(BigInt(intentParams.nonce.toString()), offset); offset += 8;

            console.log(chalk.gray(`   Serialized Intent (${message.length} bytes)`));
        } catch (e) {
            console.error("Failed to serialize Intent:", e);
            throw new Error("Failed to serialize Intent for verification");
        }

        // WALLET COMPATIBILITY: Verify the text message format matching Frontend
        // Frontend signs: `Intent Protocol Swap\n\nIntent (hex): ${intentHex}`
        const intentHex = message.toString('hex');
        console.log(chalk.yellow(`   Debug Relayer Intent Hex: ${intentHex}`));

        const messageToVerify = `Intent Protocol Swap\n\nIntent (hex): ${intentHex}`;
        const messageBuffer = Buffer.from(messageToVerify, 'utf-8');

        console.log(chalk.gray(`   Verifying text message signature (${messageBuffer.length} bytes)`));

        // Debug Hashes
        const msgHash = createHash('sha256').update(messageBuffer).digest('hex');
        const sigHash = createHash('sha256').update(Buffer.from(signature)).digest('hex');
        const keyHash = createHash('sha256').update(maker.toBuffer()).digest('hex');
        console.log(chalk.red(`   [DEBUG] MSG HASH: ${msgHash}`));
        console.log(chalk.red(`   [DEBUG] SIG HASH: ${sigHash}`));
        console.log(chalk.red(`   [DEBUG] KEY HASH: ${keyHash}`));

        const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
            publicKey: maker.toBuffer(),
            message: messageBuffer,  // Text message with hex-encoded intent
            signature: Buffer.from(signature),
        });

        console.log(chalk.yellow(`   Debug Ed25519 Ix ProgramId: ${ed25519Ix.programId.toBase58()}`));
        console.log(chalk.yellow(`   Debug Ed25519 Ix Keys: ${ed25519Ix.keys.map(k => k.pubkey.toBase58()).join(', ')}`));
        console.log(chalk.yellow(`   Debug Ed25519 Ix Data Len: ${ed25519Ix.data.length}`));

        // Derive WSOL accounts
        const takerTokenAccount = await getAssociatedTokenAddress(NATIVE_MINT, this.keypair.publicKey);
        const makerTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
            this.connection,
            this.keypair,           // payer
            NATIVE_MINT,            // mint (WSOL)
            maker,                  // owner
            true                    // allowOwnerOffCurve
        );
        const makerTokenAccount = makerTokenAccountInfo.address;

        console.log(chalk.gray(`   Taker (Relayer) WSOL: ${takerTokenAccount.toBase58()}`));
        console.log(chalk.gray(`   Maker (User) WSOL: ${makerTokenAccount.toBase58()}`));

        const accounts: any = {
            taker: this.keypair.publicKey,
            maker: maker,
            takerTokenAccount: takerTokenAccount,
            makerTokenAccount: makerTokenAccount,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            // Try explicit snake_case matching the IDL
            verify_ctx: {
                instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
            },
            // Also try camelCase just in case (redundancy usually ignored or harmless if not strict)
            verifyCtx: {
                instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
            }
        };

        console.log(chalk.yellow(`   Debug accounts: ${JSON.stringify(Object.keys(accounts))}`));
        console.log(chalk.yellow(`   Debug verify_ctx: ${JSON.stringify(accounts.verify_ctx)}`));

        // Build the Anchor instruction
        // Build the Anchor instruction
        // Convert snake_case params to camelCase for Anchor (CRITICAL FIX for InvalidParameters error)
        const fillArgs = {
            maker: intentParams.maker,
            sellToken: intentParams.sell_token,
            buyToken: intentParams.buy_token,
            sellAmount: new anchor.BN(intentParams.sell_amount),
            startAmount: new anchor.BN(intentParams.start_amount),
            endAmount: new anchor.BN(intentParams.end_amount),
            startTime: new anchor.BN(intentParams.start_time),
            endTime: new anchor.BN(intentParams.end_time),
            nonce: new anchor.BN(intentParams.nonce),
        };

        const fillIx = await this.program.methods
            .fill(fillArgs, signature)
            .accounts(accounts)
            // remainingAccounts not needed if passed in accounts
            .instruction();

        // Send transaction
        try {
            const tx = new Transaction().add(ed25519Ix).add(fillIx);
            const txSig = await sendAndConfirmTransaction(this.connection, tx, [this.keypair]);
            console.log(chalk.green(`✅ Solana Fill Tx: ${txSig}`));

            // Derive Escrow PDA for notifications
            // Seeds: "escrow", maker, hashlock (Wait, hashlock IS NOT in intent params passed here explicitly, it's inside `fillArgs`? No, hashlock is NOT used in Intent Swap seeds?)
            // Wait, look at contracts-solana: seeds = [b"escrow", maker.key().as_ref(), intent.nonce.to_le_bytes().as_ref()] OR hashlock?
            // Bot usage in `createEscrow`: `[b"escrow", maker, hashlock]`
            // Does `fill` create an escrow with the SAME seeds?
            // YES, usually it must match.
            // But `fill` instruction in lib.rs creates an escrow. What seeds does `fill` usage?
            // Check `intent-swap/programs/intent-swap/src/lib.rs` if possible?
            // Or assume Bot is correct. If Bot uses hashlock, then Relayer must use hashlock.
            // But `intentParams` passed to `fill` DOES NOT HAVE `hashlock`.
            // User passes `hashlock` in `handleMovementToSolana` params!
            // So `RelayerCore` has the hashlock, but `SolanaService.fill` doesn't receive it in `intentParams` specifically as a seed source unless I pass it.

            // Wait, look at `RelayerCore.ts` calling `fill`. It calls `fill(..., intentParams, signatureArray)`.
            // `intentParams` is the struct. It DOES NOT contain `hashlock`.
            // The `hashlock` is passed as `params.hashlock` to `handleMovementToSolana`.

            // So I can't derive PDA *inside* `fill` easily without passing hashlock.

            // CHANGE OF PLANS:
            // Instead of calculating PDA inside `SolanaService.fill`, I should calculate it in `RelayerCore.ts` where I have the `hashlock`!
            // I'll keep `SolanaService` returning string, and do calculation in Core.

            return { tx: txSig, escrowPda: "" }; // Placeholder, will fix in Core or here if I add param.
        } catch (e: any) {
            try {
                require('fs').appendFileSync('debug_relayer.log', `[${new Date().toISOString()}] Fill Error: ${e.message}\n${e.stack}\n`);
                if (e.logs) require('fs').appendFileSync('debug_relayer.log', `[${new Date().toISOString()}] Logs: ${e.logs.join('\n')}\n`);
            } catch (loggingErr) { }
            throw e;
        }
    }

    /**
     * Get SOL balance with timeout protection
     */
    async getBalances(): Promise<ChainBalance[]> {
        const balances: ChainBalance[] = [];

        try {
            const timeoutPromise = new Promise<number>((_, reject) =>
                setTimeout(() => reject(new Error('Solana RPC timeout')), 5000)
            );
            const balancePromise = this.connection.getBalance(this.keypair.publicKey);

            const solBalance = await Promise.race([balancePromise, timeoutPromise]);
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
     * Transfer SOL to a recipient (Faucet logic)
     */
    async transferSOL(recipient: string, amount: number): Promise<string> {
        console.log(chalk.cyan(`💧 Sending ${amount} SOL to ${recipient}...`));
        const amountLamports = Math.floor(amount * LAMPORTS_PER_SOL);
        const recipientPubkey = new PublicKey(recipient);

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: this.keypair.publicKey,
                toPubkey: recipientPubkey,
                lamports: amountLamports,
            })
        );

        try {
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.keypair]
            );
            console.log(chalk.green(`✅ Sent SOL: ${signature}`));
            return signature;
        } catch (error: any) {
            console.error("Failed to send SOL:", error);
            throw error;
        }
    }
}
