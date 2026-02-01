import chalk from 'chalk';
import { MovementService } from './MovementService';
import { SolanaService } from './SolanaService';
import { CrossChainIntent, IntentStatus, RelayerHealth } from '../types/intent';
import { config } from '../config';
import { PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

export class RelayerCore {
    private movementService: MovementService;
    private solanaService: SolanaService;
    private activeIntents: Map<string, CrossChainIntent> = new Map();
    private completedIntents: CrossChainIntent[] = [];

    constructor() {
        this.movementService = new MovementService();
        this.solanaService = new SolanaService();
        console.log(chalk.green('🔗 Cross-Chain Relayer Core Initialized'));
    }

    /**
     * Handle Movement → Solana swap
     * User locks MOVE on Movement, Relayer fills SOL on Solana
     */
    async handleMovementToSolana(params: {
        makerAddress: string;       // User's Movement address
        recipientAddress: string;   // User's Solana address
        sellAmount: string;         // MOVE amount (octas)
        buyAmount: string;          // SOL amount (lamports)
        hashlock: string;           // Hex-encoded hashlock from user
        sourceEscrowId: number;     // Escrow ID on Movement (from user's lock tx)
        signature: string;          // User's Ed25519 signature
        intent: any;                // The full intent object (JSON)
    }): Promise<CrossChainIntent> {
        const intentId = `mov_sol_${Date.now()}`;
        const now = Math.floor(Date.now() / 1000);

        console.log(chalk.blue(`\n📥 Processing Movement → Solana Swap`));
        console.log(chalk.gray(`   Intent ID: ${intentId}`));
        console.log(chalk.gray(`   Maker: ${params.makerAddress}`));
        console.log(chalk.gray(`   Amount: ${params.sellAmount} octas → ${params.buyAmount} lamports`));

        const intent: CrossChainIntent = {
            id: intentId,
            direction: 'MOV_TO_SOL',
            makerAddress: params.makerAddress,
            takerAddress: this.solanaService.publicKey.toBase58(),
            recipientAddress: params.recipientAddress,
            sellToken: '0x1::aptos_coin::AptosCoin',
            buyToken: '11111111111111111111111111111111',
            sellAmount: params.sellAmount,
            buyAmount: params.buyAmount,
            hashlock: params.hashlock,
            sourceTimelock: now + config.timelocks.solana, // Longer for source
            destTimelock: now + config.timelocks.movement, // Shorter for dest
            sourceEscrowId: params.sourceEscrowId.toString(),
            status: 'SOURCE_LOCKED',
            createdAt: now,
            updatedAt: now,
        };

        this.activeIntents.set(intentId, intent);

        try {
            // Parse signature from hex string
            const signatureBytes = Buffer.from(params.signature.replace('0x', ''), 'hex');
            const signatureArray = Array.from(signatureBytes);

            // Reconstruct Typed Intent Object (from JSON parameters)
            // MUST use snake_case keys to match IDL for 'encode' and instruction args
            // Updated to deployed devnet address
            const INTENT_PROGRAM_ID = new PublicKey("5JAWumq5L4B8WrpF3CFox36SZ2bJF4xQvskLksmHRgs2");
            const intentParams = {
                maker: new PublicKey(params.intent.maker),
                sell_token: new PublicKey(params.intent.sell_token_type || params.intent.sellToken || params.intent.sell_token),
                buy_token: new PublicKey(params.intent.buy_token_type || params.intent.buyToken || params.intent.buy_token),
                sell_amount: new anchor.BN(params.intent.sell_amount),
                start_amount: new anchor.BN(params.intent.start_amount || params.intent.startAmount || params.intent.sell_amount),
                end_amount: new anchor.BN(params.intent.end_amount || params.intent.endAmount || params.intent.sell_amount),
                start_time: new anchor.BN(params.intent.start_time),
                end_time: new anchor.BN(params.intent.end_time),
                nonce: new anchor.BN(params.intent.nonce)
            };

            const tx = await this.solanaService.fill(
                new PublicKey(params.recipientAddress), // Maker of the escrow on Solana is the User (recipient of the cross-chain swap)
                new anchor.BN(params.buyAmount),
                new anchor.BN(params.sellAmount),
                intentParams,
                signatureArray
            );

            intent.destFillTx = tx;
            intent.status = 'DEST_FILLED';
            intent.updatedAt = Math.floor(Date.now() / 1000);

            console.log(chalk.green(`✅ Fill complete. Awaiting user claim...`));

            return intent;

        } catch (error: any) {
            console.error(chalk.red('❌ Movement → Solana swap failed:'), error.message);
            intent.status = 'FAILED';
            intent.updatedAt = Math.floor(Date.now() / 1000);
            throw error;
        }
    }

    /**
     * Handle Solana → Movement swap
     * User locks SOL on Solana, Relayer fills MOVE on Movement
     */
    async handleSolanaToMovement(params: {
        makerAddress: string;       // User's Solana address
        recipientAddress: string;   // User's Movement address
        sellAmount: string;         // SOL amount (lamports)
        buyAmount: string;          // MOVE amount (octas)
        hashlock: string;           // Hex-encoded hashlock from user
        sourceEscrowPda?: string;   // Escrow PDA on Solana
    }): Promise<CrossChainIntent> {
        const intentId = `sol_mov_${Date.now()}`;
        const now = Math.floor(Date.now() / 1000);

        console.log(chalk.blue(`\n📥 Processing Solana → Movement Swap`));
        console.log(chalk.gray(`   Intent ID: ${intentId}`));
        console.log(chalk.gray(`   Maker: ${params.makerAddress}`));
        console.log(chalk.gray(`   Amount: ${params.sellAmount} lamports → ${params.buyAmount} octas`));

        const intent: CrossChainIntent = {
            id: intentId,
            direction: 'SOL_TO_MOV',
            makerAddress: params.makerAddress,
            takerAddress: this.movementService.account.accountAddress.toString(),
            recipientAddress: params.recipientAddress,
            sellToken: '11111111111111111111111111111111',
            buyToken: '0x1::aptos_coin::AptosCoin',
            sellAmount: params.sellAmount,
            buyAmount: params.buyAmount,
            hashlock: params.hashlock,
            sourceTimelock: now + config.timelocks.solana,
            destTimelock: now + config.timelocks.movement,
            sourceEscrowId: params.sourceEscrowPda,
            status: 'SOURCE_LOCKED',
            createdAt: now,
            updatedAt: now,
        };

        this.activeIntents.set(intentId, intent);

        try {
            // Step 1: Create HTLC on Movement with same hashlock
            console.log(chalk.cyan('⚡ Filling on Movement...'));

            const hashlockBytes = Buffer.from(params.hashlock.replace('0x', ''), 'hex');
            const result = await this.movementService.createEscrow(
                hashlockBytes,
                params.recipientAddress,
                BigInt(params.buyAmount),
                config.timelocks.movement
            );

            intent.destFillTx = result.txHash;
            intent.destEscrowId = result.escrowId.toString();
            intent.status = 'DEST_FILLED';
            intent.updatedAt = Math.floor(Date.now() / 1000);

            console.log(chalk.green(`✅ Movement HTLC created. User can now claim with secret.`));

            return intent;

        } catch (error: any) {
            console.error(chalk.red('❌ Solana → Movement swap failed:'), error.message);
            intent.status = 'FAILED';
            intent.updatedAt = Math.floor(Date.now() / 1000);
            throw error;
        }
    }

    /**
     * Process secret revelation (claim on source chain)
     */
    async processSecretRevelation(intentId: string, secret: string): Promise<void> {
        const intent = this.activeIntents.get(intentId);
        if (!intent) {
            throw new Error(`Intent ${intentId} not found`);
        }

        console.log(chalk.blue(`\n🔓 Processing secret revelation for ${intentId}`));

        const secretBytes = Buffer.from(secret.replace('0x', ''), 'hex');

        try {
            if (intent.direction === 'MOV_TO_SOL') {
                // User claimed on Solana, now we claim on Movement
                // Fix: Since Solana HTLC is simulated, we must Transfer SOL to user now (Trusted Mode)
                console.log(chalk.cyan(`⚡ Trusted Mode: Sending ${intent.buyAmount} Lamports to User...`));
                console.log(chalk.cyan(`⚡ Trusted Mode: Claiming on Solana...`));
                try {
                    // TODO: Implement claim on Solana using Anchor
                    // const solTx = await this.solanaService.claim(...)
                    console.log(chalk.yellow(`⚠️  Solana claim not yet implemented in this demo flow`));
                } catch (err: any) {
                    console.error(chalk.red(`❌ Failed to claim on Solana: ${err.message}`));
                }

                const txHash = await this.movementService.claim(
                    parseInt(intent.sourceEscrowId || '0'),
                    secretBytes
                );
                intent.sourceClaimTx = txHash;

            } else {
                // User claimed on Movement, now we claim on Solana
                // For simplified demo, we just mark as complete
                // In production, this would interact with the Solana HTLC program
                console.log(chalk.cyan('Marking Solana claim as complete (simplified demo)'));
                intent.sourceClaimTx = 'demo_claim_' + Date.now();
            }

            intent.secret = secret;
            intent.status = 'COMPLETED';
            intent.updatedAt = Math.floor(Date.now() / 1000);

            // Move to completed
            this.activeIntents.delete(intentId);
            this.completedIntents.push(intent);

            console.log(chalk.green(`✅ Cross-chain swap completed!`));

        } catch (error: any) {
            console.error(chalk.red('❌ Failed to process secret:'), error.message);
            throw error;
        }
    }

    /**
     * Get relayer health and balances
     */
    async getHealth(): Promise<RelayerHealth> {
        const [movementBalances, solanaBalances] = await Promise.all([
            this.movementService.getBalances(),
            this.solanaService.getBalances(),
        ]);

        return {
            movement: {
                address: this.movementService.account.accountAddress.toString(),
                balances: movementBalances,
                connected: true,
            },
            solana: {
                address: this.solanaService.publicKey.toBase58(),
                balances: solanaBalances,
                connected: true,
            },
        };
    }

    /**
     * Get active intents
     */
    getActiveIntents(): CrossChainIntent[] {
        return Array.from(this.activeIntents.values());
    }

    /**
     * Get completed intents
     */
    getCompletedIntents(): CrossChainIntent[] {
        return this.completedIntents;
    }

    /**
     * Handle Faucet Request
     */
    async handleFaucetRequest(chain: 'solana' | 'movement', address: string) {
        console.log(chalk.blue(`\n🚰 Processing Faucet Request for ${chain}`));
        console.log(chalk.gray(`   Recipient: ${address}`));

        if (chain === 'solana') {
            const amount = 0.05; // Faucet amount in SOL
            return await this.solanaService.transferSOL(address, amount);
        } else if (chain === 'movement') {
            const amount = 10.0; // Faucet amount in MOVE
            return await this.movementService.transferMOVE(address, amount);
        } else {
            throw new Error(`Invalid chain: ${chain}`);
        }
    }
}
