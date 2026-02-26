const fs = require('fs');
const path = require('path');

const relayerPath = path.join(__dirname, '../src/services/BCHSolanaRelayerCore.ts');
let code = fs.readFileSync(relayerPath, 'utf-8');

// 1. Add Import
if (!code.includes("import { MovementService }")) {
    code = code.replace(
        "import { SolanaService } from './SolanaService';",
        "import { SolanaService } from './SolanaService';\nimport { MovementService } from './MovementService';"
    );
}

// 2. Add Class Property
if (!code.includes("private movementService: MovementService;")) {
    code = code.replace(
        "private solanaService: SolanaService;",
        "private solanaService: SolanaService;\n    private movementService: MovementService;"
    );
}

// 3. Instantiate in Constructor
if (!code.includes("this.movementService = new MovementService();")) {
    code = code.replace(
        "this.solanaService = new SolanaService();",
        "this.solanaService = new SolanaService();\n        this.movementService = new MovementService();"
    );
}

// 4. Inject Handlers before pollIntents
const handlers = `
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
    }): Promise<any> {
        const intentId = \`bch_mov_\${Date.now()}\`;
        const now = Math.floor(Date.now() / 1000);

        console.log(chalk.blue(\`\\n📥 Processing BCH → Movement Swap\`));
        const intent: any = {
            id: intentId,
            direction: 'BCH_TO_MOV',
            makerAddress: params.makerAddress,
            takerAddress: this.movementService.account.accountAddress.toString(),
            recipientAddress: params.recipientAddress,
            sellAmount: params.sellAmount,
            buyAmount: params.buyAmount,
            hashlock: params.hashlock,
            sourceTimelock: now + config.timelocks.source,
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
        const intentId = \`mov_bch_\${Date.now()}\`;
        const now = Math.floor(Date.now() / 1000);

        console.log(chalk.blue(\`\\n📥 Processing Movement → BCH Swap\`));
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
`;

if (!code.includes("handleBCHToMovement")) {
    code = code.replace(
        "    private async pollIntents()",
        handlers + "\n    private async pollIntents()"
    );
}

// 5. Replace pollIntents body
// Using regex to reliably find the block
const regex = /private async pollIntents\(\)\s*\{[\s\S]*?catch \(e: any\) \{[\s\S]*?\}\s*\}\s*\}/m;
const newPollIntents = `private async pollIntents() {
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
                console.error(chalk.red(\`Error processing intent \${id}:\`), e.message);
            }
        }
    }`;

code = code.replace(regex, newPollIntents);


// 6. Inject Processors before "Atomic Settlement Actions"
const processors = `
    /**
     * Process Logic: BCH -> Movement
     */
    private async processBCHToMovement(intent: any) {
        if (intent.status === 'PENDING' && intent.bchContractAddress) {
            const balance = await this.bchService.getHTLCBalance(intent.bchContractAddress);
            if (balance >= BigInt(intent.sellAmount)) {
                console.log(chalk.green(\`✅ BCH Locked confirmed: \${balance} sats\`));
                intent.status = 'SOURCE_LOCKED';
                intent.updatedAt = Date.now();
            }
        }

        if (intent.status === 'SOURCE_LOCKED' && !intent.destFillTx) {
            console.log(chalk.cyan(\`⚡ Filling on Movement (Destination)...\`));
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
            console.log(chalk.green(\`✅ Movement Filled. Waiting for User to claim...\`));
        }

        if (intent.status === 'DEST_FILLED' && intent.movementEscrowId) {
            const details = await this.movementService.getEscrowDetails(parseInt(intent.movementEscrowId));
            if (details && Array.isArray(details) && details.length > 0) {
                const escrowData = details[0] as any;
                if (escrowData.is_claimed && escrowData.secret) {
                    const secretHex = escrowData.secret.replace('0x', '');
                    console.log(chalk.green(\`✅ Secret Revealed on Movement: \${secretHex}\`));
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
            console.log(chalk.green(\`✅ Movement Locked confirmed (Simulated check)\`));
        }

        if (intent.status === 'SOURCE_LOCKED' && !intent.destFillTx) {
            console.log(chalk.cyan(\`⚡ Filling on BCH (Destination)...\`));
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
            console.log(chalk.green(\`✅ BCH Filled. Waiting for User to claim...\`));
        }

        if (intent.status === 'DEST_FILLED' && intent.bchContractAddress) {
            const history = await this.bchService.getHistory(intent.bchContractAddress);
            const spendingTx = history.find((h: any) => h.tx_hash !== intent.destFillTx);
            if (spendingTx) {
                console.log(chalk.blue(\`   Detected spending tx on BCH: \${(spendingTx as any).tx_hash}\`));
                const secret = await this.bchService.extractSecret((spendingTx as any).tx_hash);
                if (secret) {
                    console.log(chalk.green(\`✅ Secret Revealed on BCH: \${secret}\`));
                    intent.secret = secret;
                    intent.destClaimTx = (spendingTx as any).tx_hash;
                    intent.status = 'DEST_CLAIMED';
                    await this.claimSourceMovement(intent);
                }
            }
        }
    }
`;

if (!code.includes("processBCHToMovement")) {
    code = code.replace(
        "    // =========================================",
        processors + "\n    // ========================================="
    );
}

// 7. Inject claimSourceMovement
const claimSourceMovement = `
    /**
     * Claim the User's locked MOVE (MOV->BCH flow key step)
     */
    private async claimSourceMovement(intent: any) {
        if (!intent.secret || !intent.movementEscrowId) return;
        try {
            console.log(chalk.cyan(\`⚡ Claiming Source Movement...\`));
            const secretBuf = Buffer.from(intent.secret.replace('0x', ''), 'hex');
            const txId = await this.movementService.claim(
                parseInt(intent.movementEscrowId),
                secretBuf
            );
            intent.sourceClaimTx = txId;
            intent.status = 'COMPLETED';
            console.log(chalk.green(\`✅ Swap Complete! Claimed MOVE: \${txId}\`));
            this.activeIntents.delete(intent.id);
            this.completedIntents.push(intent);
        } catch (e: any) {
            console.error(chalk.red('Failed to claim source MOVE:'), e.message);
        }
    }
`;

if (!code.includes("claimSourceMovement")) {
    code = code.replace(
        "    // Getters",
        claimSourceMovement + "\n    // Getters"
    );
}

fs.writeFileSync(relayerPath, code);
console.log('Successfully refactored BCHSolanaRelayerCore.ts');
