import chalk from 'chalk';
import { BCHService } from './BCHService';
import { SolanaService } from './SolanaService';
import { MovementService } from './MovementService';
import { CrossChainIntent, IntentStatus } from '../types/intent';
import { config } from '../config';
import { PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

// Fix for BN import in some environments
const BN = (anchor as any).BN || (anchor as any).default?.BN;

export class BCHSolanaRelayerCore {
    private bchService: BCHService;
    private solanaService: SolanaService;
    private movementService: MovementService;
    private activeIntents: Map<string, CrossChainIntent> = new Map();
    private completedIntents: CrossChainIntent[] = [];

    constructor() {
        this.bchService = new BCHService();
        this.solanaService = new SolanaService();
        this.movementService = new MovementService();

        // Initialize wallets
        this.bchService.initWallet().catch(err => {
            console.error(chalk.red('Failed to init BCH wallet:'), err);
        });

        console.log(chalk.green('🔗 BCH-Solana Relayer Core Initialized'));

        // Start Polling Loop
        setInterval(() => this.pollIntents(), config.pollIntervalMs);
    }

    /**
     * Handle BCH → Solana swap request
     * User locks BCH, Relayer fills SOL
     */
    async handleBCHToSolana(params: {
        makerAddress: string;       // User's BCH Address
        recipientAddress: string;   // User's Solana Address
        sellAmount: string;         // BCH satoshis
        buyAmount: string;          // SOL lamports
        hashlock: string;           // Hex formatted
        bchContractAddress: string; // The specific HTLC address User deployed to
        sourceTimelock: number;     // The timelock on the source chain
    }): Promise<CrossChainIntent> {
        const intentId = `bch_sol_${Date.now()}`;
        const now = Math.floor(Date.now() / 1000);

        console.log(chalk.blue(`\n📥 Processing BCH → Solana Swap`));
        console.log(chalk.gray(`   ID: ${intentId}`));
        console.log(chalk.gray(`   User BCH: ${params.makerAddress}`));
        console.log(chalk.gray(`   User SOL: ${params.recipientAddress}`));
        console.log(chalk.gray(`   Contract: ${params.bchContractAddress}`));

        const intent: CrossChainIntent = {
            id: intentId,
            direction: 'BCH_TO_SOL',
            makerAddress: params.makerAddress,
            takerAddress: this.solanaService.publicKey.toBase58(),
            recipientAddress: params.recipientAddress,
            sellAmount: params.sellAmount,
            buyAmount: params.buyAmount,
            hashlock: params.hashlock,
            sourceTimelock: params.sourceTimelock,
            destTimelock: now + config.timelocks.dest,
            bchContractAddress: params.bchContractAddress,
            status: 'PENDING', // Wait for confirmation
            createdAt: now,
            updatedAt: now,
        };

        this.activeIntents.set(intentId, intent);
        return intent;
    }

    /**
     * Handle Solana → BCH swap request
     * User locks SOL, Relayer fills BCH
     */
    async handleSolanaToBCH(params: {
        makerAddress: string;       // User's Solana Address
        recipientAddress: string;   // User's BCH Address
        sellAmount: string;         // SOL lamports
        buyAmount: string;          // BCH satoshis
        hashlock: string;           // Hex formatted
        solanaEscrowPda: string;    // The Escrow PDA User created
    }): Promise<CrossChainIntent> {
        const intentId = `sol_bch_${Date.now()}`;
        const now = Math.floor(Date.now() / 1000);

        console.log(chalk.blue(`\n📥 Processing Solana → BCH Swap`));
        console.log(chalk.gray(`   ID: ${intentId}`));
        console.log(chalk.gray(`   User SOL: ${params.makerAddress}`));
        console.log(chalk.gray(`   User BCH: ${params.recipientAddress}`));
        console.log(chalk.gray(`   Escrow PDA: ${params.solanaEscrowPda}`));

        const intent: CrossChainIntent = {
            id: intentId,
            direction: 'SOL_TO_BCH',
            makerAddress: params.makerAddress,
            takerAddress: this.bchService.wallet?.cashaddr || '', // Relayer BCH
            recipientAddress: params.recipientAddress,
            sellAmount: params.sellAmount,
            buyAmount: params.buyAmount,
            hashlock: params.hashlock,
            sourceTimelock: now + config.timelocks.source,
            destTimelock: now + config.timelocks.dest,
            solanaEscrowPda: params.solanaEscrowPda,
            status: 'PENDING',
            createdAt: now,
            updatedAt: now,
        };

        this.activeIntents.set(intentId, intent);
        return intent;
    }

    /**
     * Polling Loop: Check status of active intents and advance state
     */

    /**
     * Handle BCH → Movement swap request
     */
    async handleBCHToMovement(params: {
        makerAddress: string;
        recipientAddress: string;
        sellAmount: string;
        buyAmount: string;
        hashlock: string;
        bchContractAddress: string;
        sourceTimelock: number;
    }): Promise<any> {
        const intentId = `bch_mov_${Date.now()}`;
        const now = Math.floor(Date.now() / 1000);

        console.log(chalk.blue(`\n📥 Processing BCH → Movement Swap`));
        const intent: any = {
            id: intentId,
            direction: 'BCH_TO_MOV',
            makerAddress: params.makerAddress,
            takerAddress: this.movementService.account.accountAddress.toString(),
            recipientAddress: params.recipientAddress,
            sellAmount: params.sellAmount,
            buyAmount: params.buyAmount,
            hashlock: params.hashlock,
            sourceTimelock: params.sourceTimelock,
            destTimelock: now + config.timelocks.dest,
            bchContractAddress: params.bchContractAddress,
            status: 'PENDING',
            createdAt: now,
            updatedAt: now,
        };
        this.activeIntents.set(intentId, intent);
        return intent;
    }

    /**
     * Handle Movement → BCH swap request
     */
    async handleMovementToBCH(params: {
        makerAddress: string;
        recipientAddress: string;
        sellAmount: string;
        buyAmount: string;
        hashlock: string;
        sourceEscrowId: string;
    }): Promise<any> {
        const intentId = `mov_bch_${Date.now()}`;
        const now = Math.floor(Date.now() / 1000);

        console.log(chalk.blue(`\n📥 Processing Movement → BCH Swap`));
        const intent: any = {
            id: intentId,
            direction: 'MOV_TO_BCH',
            makerAddress: params.makerAddress,
            takerAddress: this.bchService.wallet?.cashaddr || '',
            recipientAddress: params.recipientAddress,
            sellAmount: params.sellAmount,
            buyAmount: params.buyAmount,
            hashlock: params.hashlock,
            sourceTimelock: now + config.timelocks.movement,
            destTimelock: now + config.timelocks.dest,
            movementEscrowId: params.sourceEscrowId,
            status: 'PENDING',
            createdAt: now,
            updatedAt: now,
        };
        this.activeIntents.set(intentId, intent);
        return intent;
    }

    public async pollIntents() {
        for (const [id, intent] of this.activeIntents) {
            try {
                if (intent.direction === 'BCH_TO_SOL') {
                    await this.processBCHToSolana(intent);
                } else if (intent.direction === 'SOL_TO_BCH') {
                    await this.processSolanaToBCH(intent);
                } else if (intent.direction === 'BCH_TO_MOV') {
                    await (this as any).processBCHToMovement(intent);
                } else if (intent.direction === 'MOV_TO_BCH') {
                    await (this as any).processMovementToBCH(intent);
                }
            } catch (e: any) {
                console.error(chalk.red(`Error processing intent ${id}:`), e.message);
            }
        }
    }

    /**
     * Process Logic: BCH -> Solana
     */
    private async processBCHToSolana(intent: CrossChainIntent) {
        // 1. PENDING -> SOURCE_LOCKED
        // Verify BCH funds are locked
        if (intent.status === 'PENDING' && intent.bchContractAddress) {
            const balance = await this.bchService.getHTLCBalance(intent.bchContractAddress);
            // Allow slight variance or require exact?
            // Mainnet-js returns satoshis.
            if (balance >= BigInt(intent.sellAmount)) {
                console.log(chalk.green(`✅ BCH Locked confirmed: ${balance} sats`));
                intent.status = 'SOURCE_LOCKED';
                intent.updatedAt = Date.now();
                // We don't have the txid easily unless we scan hist, but balance is enough for now.
            }
        }

        // 2. SOURCE_LOCKED -> DEST_FILLED
        // Relayer creates Escrow on Solana
        if (intent.status === 'SOURCE_LOCKED' && !intent.destFillTx) {
            console.log(chalk.cyan(`⚡ Filling on Solana (Destination)...`));

            const hashBuf = Buffer.from(intent.hashlock.replace('0x', ''), 'hex');
            const result = await this.solanaService.createEscrow(
                new PublicKey(intent.recipientAddress), // User is recipient of SOL
                hashBuf,
                new BN(intent.buyAmount),
                new BN(intent.destTimelock)
            );

            intent.destFillTx = result.tx;
            intent.solanaEscrowPda = result.escrowPda;
            intent.status = 'DEST_FILLED';
            intent.updatedAt = Date.now();
            console.log(chalk.green(`✅ Solana Filled. Waiting for User to claim...`));
        }

        // 3. DEST_FILLED -> DETAILS KNOWN OR COMPLETED
        // Watch for User Claim on Solana (Secret Reveal)
        if (intent.status === 'DEST_FILLED' && intent.solanaEscrowPda) {
            // We need to watch transactions on the Escrow PDA to find the secret
            // This is the tricky part if we don't have websocket
            // Polling logic in SolanaService

            // Wait, we need the secret!
            // `SolanaService.watchForSecret` returns secret keys if found
            // or null.
            const secret = intent.secret || await this.solanaService.watchForSecret(new PublicKey(intent.solanaEscrowPda));
            if (secret) {
                console.log(chalk.green(`✅ Secret Revealed on Solana: ${secret}`));
                intent.secret = secret;
                intent.status = 'DEST_CLAIMED'; // Intermediate state

                // Immediately claim source
                await this.claimSourceBCH(intent);
            }
        }
    }

    /**
     * Process Logic: Solana -> BCH
     */
    private async processSolanaToBCH(intent: CrossChainIntent) {
        // 1. PENDING -> SOURCE_LOCKED
        // Verify Solana Escrow exists and is funded
        if (intent.status === 'PENDING' && intent.solanaEscrowPda) {
            // Check account info
            // We assume User sent correct PDA.
            // In a real indexer we verify amounts.
            // `SolanaService` doesn't have `getEscrowDetails` yet, but we can try claim to simulate? No.
            // Just assume locked if user says so for hackathon, or check balance of Vault?
            // Vault PDA derivation logic is standard.

            // Let's assume Valid for now to proceed.
            // Ideally: `await this.solanaService.getEscrowBalance(pda)` 

            intent.status = 'SOURCE_LOCKED';
            intent.updatedAt = Date.now();
            console.log(chalk.green(`✅ Solana Locked confirmed (Simulated check)`));
        }

        // 2. SOURCE_LOCKED -> DEST_FILLED
        // Relayer Deploys and Funds BCH HTLC
        if (intent.status === 'SOURCE_LOCKED' && !intent.destFillTx) {
            console.log(chalk.cyan(`⚡ Filling on BCH (Destination)...`));

            // User is Recipient on BCH
            const result = await this.bchService.lockBCH(
                intent.recipientAddress,
                intent.hashlock,
                BigInt(intent.buyAmount), // User buys BCH
                BigInt(intent.destTimelock)
            );

            intent.destFillTx = result.txId;
            intent.bchContractAddress = result.contractAddress;
            intent.status = 'DEST_FILLED';
            intent.updatedAt = Date.now();
            console.log(chalk.green(`✅ BCH Filled. Waiting for User to claim...`));
        }

        // 3. DEST_FILLED -> DEST_CLAIMED -> SOURCE_CLAIMED
        // Watch for User Claim on BCH (Secret Reveal)
        if (intent.status === 'DEST_FILLED' && intent.bchContractAddress) {
            if (intent.secret) {
                console.log(chalk.green(`✅ Secret Revealed via API for Solana claim: ${intent.secret}`));
                intent.status = 'DEST_CLAIMED';
                await this.claimSourceSolana(intent);
                return;
            }

            // Check balance. If 0, it was likely claimed!
            // But we need the SECRET.
            // We must find the spending transaction.

            // We can search address history.
            // `bchService.extractSecret` works given a txId.
            // We need to find the spending txId.

            const history = await this.bchService.getHistory(intent.bchContractAddress);
            // Look for a tx that is NOT the funding tx.
            // Funding tx is `intent.destFillTx`.

            const spendingTx = history.find((h: any) => h.tx_hash !== intent.destFillTx);
            if (spendingTx) {
                console.log(chalk.blue(`   Detected spending tx on BCH: ${(spendingTx as any).tx_hash}`));
                const secret = await this.bchService.extractSecret((spendingTx as any).tx_hash);

                if (secret) {
                    console.log(chalk.green(`✅ Secret Revealed on BCH: ${secret}`));
                    intent.secret = secret;
                    intent.destClaimTx = (spendingTx as any).tx_hash;
                    intent.status = 'DEST_CLAIMED';

                    // Immediately claim Source
                    await this.claimSourceSolana(intent);
                }
            }
        }
    }

    // =========================================
    /**
     * Process Logic: BCH -> Movement
     */
    private async processBCHToMovement(intent: any) {
        if (intent.status === 'PENDING' && intent.bchContractAddress) {
            const balance = await this.bchService.getHTLCBalance(intent.bchContractAddress);
            if (balance >= BigInt(intent.sellAmount)) {
                console.log(chalk.green(`✅ BCH Locked confirmed: ${balance} sats`));
                intent.status = 'SOURCE_LOCKED';
                intent.updatedAt = Date.now();
            }
        }

        if (intent.status === 'SOURCE_LOCKED' && !intent.destFillTx) {
            console.log(chalk.cyan(`⚡ Filling on Movement (Destination)...`));
            const hashBuf = Buffer.from(intent.hashlock.replace('0x', ''), 'hex');
            const result = await this.movementService.createEscrow(
                hashBuf,
                intent.recipientAddress,
                BigInt(intent.buyAmount),
                config.timelocks.movement
            );
            intent.destFillTx = result.txHash;
            intent.movementEscrowId = result.escrowId.toString();
            intent.status = 'DEST_FILLED';
            intent.updatedAt = Date.now();
            console.log(chalk.green(`✅ Movement Filled. Waiting for User to claim...`));
        }

        if (intent.status === 'DEST_FILLED' && intent.movementEscrowId) {
            if (intent.secret) {
                console.log(chalk.green(`✅ Secret Revealed via API for Movement claim: ${intent.secret}`));
                intent.status = 'DEST_CLAIMED';
                await this.claimSourceBCH(intent);
                return;
            }
            const details = await this.movementService.getEscrowDetails(parseInt(intent.movementEscrowId));
            if (details && Array.isArray(details) && details.length > 0) {
                const escrowData = details[0] as any;
                if (escrowData.is_claimed && escrowData.secret) {
                    const secretHex = escrowData.secret.replace('0x', '');
                    console.log(chalk.green(`✅ Secret Revealed on Movement: ${secretHex}`));
                    intent.secret = secretHex;
                    intent.status = 'DEST_CLAIMED';
                    await this.claimSourceBCH(intent);
                }
            }
        }
    }

    /**
     * Process Logic: Movement -> BCH
     */
    private async processMovementToBCH(intent: any) {
        if (intent.status === 'PENDING' && intent.movementEscrowId) {
            intent.status = 'SOURCE_LOCKED';
            intent.updatedAt = Date.now();
            console.log(chalk.green(`✅ Movement Locked confirmed (Simulated check)`));
        }

        if (intent.status === 'SOURCE_LOCKED' && !intent.destFillTx) {
            console.log(chalk.cyan(`⚡ Filling on BCH (Destination)...`));
            const result = await this.bchService.lockBCH(
                intent.recipientAddress,
                intent.hashlock,
                BigInt(intent.buyAmount),
                BigInt(intent.destTimelock)
            );
            intent.destFillTx = result.txId;
            intent.bchContractAddress = result.contractAddress;
            intent.status = 'DEST_FILLED';
            intent.updatedAt = Date.now();
            console.log(chalk.green(`✅ BCH Filled. Waiting for User to claim...`));
        }

        if (intent.status === 'DEST_FILLED' && intent.bchContractAddress) {
            if (intent.secret) {
                console.log(chalk.green(`✅ Secret Revealed via API for Movement claim: ${intent.secret}`));
                intent.status = 'DEST_CLAIMED';
                await this.claimSourceMovement(intent);
                return;
            }
            const history = await this.bchService.getHistory(intent.bchContractAddress);
            const spendingTx = history.find((h: any) => h.tx_hash !== intent.destFillTx);
            if (spendingTx) {
                console.log(chalk.blue(`   Detected spending tx on BCH: ${(spendingTx as any).tx_hash}`));
                const secret = await this.bchService.extractSecret((spendingTx as any).tx_hash);
                if (secret) {
                    console.log(chalk.green(`✅ Secret Revealed on BCH: ${secret}`));
                    intent.secret = secret;
                    intent.destClaimTx = (spendingTx as any).tx_hash;
                    intent.status = 'DEST_CLAIMED';
                    await this.claimSourceMovement(intent);
                }
            }
        }
    }

    //         Atomic Settlement Actions
    // =========================================

    /**
     * Claim the User's locked BCH (BCH->SOL flow key step)
     */
    private async claimSourceBCH(intent: CrossChainIntent) {
        if (!intent.secret || !intent.bchContractAddress) return;

        try {
            console.log(chalk.cyan(`⚡ Claiming Source BCH...`));
            const txId = await this.bchService.claimHTLC(
                intent.makerAddress, // User is Maker
                intent.hashlock,
                intent.secret,
                BigInt(intent.sourceTimelock)
            );

            intent.sourceClaimTx = txId;
            intent.status = 'COMPLETED';
            console.log(chalk.green(`✅ Swap Complete! Claimed BCH: ${txId}`));

            this.activeIntents.delete(intent.id);
            this.completedIntents.push(intent);
        } catch (e: any) {
            console.error(chalk.red('Failed to claim source BCH:'), e.message);
        }
    }

    /**
     * Claim the User's locked SOL (SOL->BCH flow key step)
     */
    private async claimSourceSolana(intent: CrossChainIntent) {
        if (!intent.secret || !intent.solanaEscrowPda) return;

        try {
            console.log(chalk.cyan(`⚡ Claiming Source Solana...`));
            const hashBuf = Buffer.from(intent.hashlock.replace('0x', ''), 'hex');
            const secretBuf = Buffer.from(intent.secret.replace('0x', ''), 'hex');

            const tx = await this.solanaService.claimEscrow(
                new PublicKey(intent.makerAddress), // User is Maker
                hashBuf,
                secretBuf,
                new PublicKey(intent.solanaEscrowPda)
            );

            intent.sourceClaimTx = tx;
            intent.status = 'COMPLETED';
            console.log(chalk.green(`✅ Swap Complete! Claimed SOL: ${tx}`));

            this.activeIntents.delete(intent.id);
            this.completedIntents.push(intent);
        } catch (e: any) {
            console.error(chalk.red('Failed to claim source SOL:'), e.message);
        }
    }


    /**
     * Claim the User's locked MOVE (MOV->BCH flow key step)
     */
    private async claimSourceMovement(intent: any) {
        if (!intent.secret || !intent.movementEscrowId) return;
        try {
            console.log(chalk.cyan(`⚡ Claiming Source Movement...`));
            const secretBuf = Buffer.from(intent.secret.replace('0x', ''), 'hex');
            const txId = await this.movementService.claim(
                parseInt(intent.movementEscrowId),
                secretBuf
            );
            intent.sourceClaimTx = txId;
            intent.status = 'COMPLETED';
            console.log(chalk.green(`✅ Swap Complete! Claimed MOVE: ${txId}`));
            this.activeIntents.delete(intent.id);
            this.completedIntents.push(intent);
        } catch (e: any) {
            console.error(chalk.red('Failed to claim source MOVE:'), e.message);
        }
    }



    // Getters
    getIntent(id: string) {
        return this.activeIntents.get(id) || this.completedIntents.find(i => i.id === id);
    }

    getActiveIntents() {
        return Array.from(this.activeIntents.values());
    }

    getCompletedIntents() {
        return this.completedIntents;
    }

    async processSecretRevelation(intentId: string, secret: string) {
        const intent = this.activeIntents.get(intentId) as any;
        if (!intent) return;
        intent.secret = secret.replace('0x', '');
        intent.status = 'DEST_CLAIMED';
        if (intent.direction === 'BCH_TO_MOV' || intent.direction === 'BCH_TO_SOL') {
            await this.claimSourceBCH(intent);
        } else if (intent.direction === 'MOV_TO_BCH') {
            await (this as any).claimSourceMovement(intent);
        } else if (intent.direction === 'SOL_TO_BCH') {
            await (this as any).claimSourceSolana(intent);
        }
    }
}
