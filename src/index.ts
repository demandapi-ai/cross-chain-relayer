import fastify from 'fastify';
import cors from '@fastify/cors';
import chalk from 'chalk';
import { config } from './config.js';
import { BCHSolanaRelayerCore } from './services/BCHSolanaRelayerCore.js';

const server = fastify({ logger: false });
server.register(cors, { origin: true });

let relayer: BCHSolanaRelayerCore;

// 1. Health
server.get('/health', async () => {
    return {
        status: 'ok',
        chains: {
            bch: 'chipnet',
            solana: 'devnet'
        },
        services: {
            bch: !!(relayer as any).bchService.wallet, // Quick check
            solana: true
        },
        pubkeys: {
            bch: (relayer as any).bchService.wallet?.cashaddr || '',
            solana: (relayer as any).solanaService.publicKey.toBase58(),
            movement: (relayer as any).movementService.account?.accountAddress?.toString() || ''
        }
    };
});

// 2. Orders
server.get('/orders', async () => {
    return {
        active: relayer.getActiveIntents(),
        completed: relayer.getCompletedIntents().slice(-20)
    };
});

// 3. Status
server.get('/intents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const intent = relayer.getIntent(id);
    if (!intent) return reply.code(404).send({ error: 'Not found' });
    return { intent };
});

// 4. BCH -> Solana Swap
server.post('/swap/bch-to-solana', async (request, reply) => {
    const body = request.body as any;
    // Required: makerAddress, recipientAddress, sellAmount, buyAmount, hashlock, bchContractAddress
    try {
        console.log("---- RECEIVING SWAP ----\\nBody Hashlock:", body.hashlock); const intent = await relayer.handleBCHToSolana(body); console.log("Intent Hashlock:", intent.hashlock);
        return { success: true, intent };
    } catch (e: any) {
        return reply.code(500).send({ error: e.message });
    }
});

// 5. Solana -> BCH Swap
server.post('/swap/solana-to-bch', async (request, reply) => {
    const body = request.body as any;
    // Required: makerAddress, recipientAddress, sellAmount, buyAmount, hashlock, solanaEscrowPda
    try {
        const intent = await relayer.handleSolanaToBCH(body);
        return { success: true, intent };
    } catch (e: any) {
        return reply.code(500).send({ error: e.message });
    }
});

// 6. BCH -> Movement Swap
server.post('/swap/bch-to-move', async (request, reply) => {
    const body = request.body as any;
    // Validate required fields
    if (!body.recipientAddress) {
        return reply.code(400).send({ error: 'Missing recipientAddress — connect your Movement wallet first' });
    }
    if (!body.hashlock || String(body.hashlock).replace('0x', '').length < 2) {
        return reply.code(400).send({ error: 'Missing or invalid hashlock' });
    }
    if (!body.bchContractAddress) {
        return reply.code(400).send({ error: 'Missing bchContractAddress' });
    }
    try {
        const intent = await (relayer as any).handleBCHToMovement(body);
        return { success: true, intent };
    } catch (e: any) {
        return reply.code(500).send({ error: e.message });
    }
});

// 7. Movement -> BCH Swap
server.post('/swap/move-to-bch', async (request, reply) => {
    const body = request.body as any;
    // Required: makerAddress, recipientAddress, sellAmount, buyAmount, hashlock, sourceEscrowId
    try {
        const intent = await (relayer as any).handleMovementToBCH(body);
        return { success: true, intent };
    } catch (e: any) {
        return reply.code(500).send({ error: e.message });
    }
});

// 9. Solver dashboard data — wallet addresses, balances, fill/claim flows
server.get('/solver', async () => {
    const bchService = (relayer as any).bchService;
    const solanaService = (relayer as any).solanaService;
    const movementService = (relayer as any).movementService;

    // Get balances from each chain
    let bchBalance = 0;
    try { bchBalance = Number(await bchService.getBalance?.()); } catch { /* ok */ }

    let solBalance = 0;
    try {
        const solBal = await solanaService.connection.getBalance(solanaService.keypair.publicKey);
        solBalance = solBal / 1e9; // lamports to SOL
    } catch { /* ok */ }

    let moveBalances: any[] = [];
    try { moveBalances = await movementService.getBalances(); } catch { /* ok */ }

    const active = relayer.getActiveIntents();
    const completed = relayer.getCompletedIntents();
    const all = [...active, ...completed];

    // Calculate financial summary
    const filled = { bch: 0, sol: 0, move: 0 };
    const claimed = { bch: 0, sol: 0, move: 0 };

    all.forEach((i: any) => {
        const dir = i.direction || '';
        // Relayer fills on the DESTINATION chain
        if (i.destFillTx) {
            if (dir === 'BCH_TO_SOL') filled.sol += Number(i.buyAmount || 0) / 1e9;
            if (dir === 'SOL_TO_BCH' || dir === 'MOV_TO_BCH') filled.bch += Number(i.buyAmount || 0) / 1e8;
            if (dir === 'BCH_TO_MOV') filled.move += Number(i.buyAmount || 0) / 1e8;
        }
        // Relayer claims on the SOURCE chain
        if (i.sourceClaimTx) {
            if (dir === 'BCH_TO_SOL' || dir === 'BCH_TO_MOV') claimed.bch += Number(i.sellAmount || 0) / 1e8;
            if (dir === 'SOL_TO_BCH') claimed.sol += Number(i.sellAmount || 0) / 1e9;
            if (dir === 'MOV_TO_BCH') claimed.move += Number(i.sellAmount || 0) / 1e8;
        }
    });

    return {
        wallets: {
            bch: { address: bchService.wallet?.cashaddr || '', balance: bchBalance, explorer: `https://chipnet.chaingraph.cash/address/${bchService.wallet?.cashaddr || ''}` },
            solana: { address: solanaService.keypair.publicKey.toBase58(), balance: solBalance, explorer: `https://explorer.solana.com/address/${solanaService.keypair.publicKey.toBase58()}?cluster=devnet` },
            movement: { address: movementService.account.accountAddress.toString(), balances: moveBalances, explorer: `https://explorer.movementnetwork.xyz/account/${movementService.account.accountAddress.toString()}?network=testnet` },
        },
        financials: { filled, claimed },
        intents: {
            active: active.map((i: any) => ({
                id: i.id,
                direction: i.direction,
                status: i.status,
                failReason: i.failReason,
                fillRetries: i.fillRetries || 0,
                sellAmount: i.sellAmount,
                buyAmount: i.buyAmount,
                recipientAddress: i.recipientAddress,
                makerAddress: i.makerAddress,
                destFillTx: i.destFillTx,
                sourceClaimTx: i.sourceClaimTx,
                bchContractAddress: i.bchContractAddress,
                solanaEscrowPda: i.solanaEscrowPda,
                movementEscrowId: i.movementEscrowId,
                createdAt: i.createdAt,
                updatedAt: i.updatedAt,
            })),
            completed: completed.slice(-50).map((i: any) => ({
                id: i.id,
                direction: i.direction,
                status: i.status,
                failReason: i.failReason,
                sellAmount: i.sellAmount,
                buyAmount: i.buyAmount,
                recipientAddress: i.recipientAddress,
                makerAddress: i.makerAddress,
                destFillTx: i.destFillTx,
                sourceClaimTx: i.sourceClaimTx,
                bchContractAddress: i.bchContractAddress,
                solanaEscrowPda: i.solanaEscrowPda,
                movementEscrowId: i.movementEscrowId,
                createdAt: i.createdAt,
                updatedAt: i.updatedAt,
            })),
        },
        stats: {
            totalActive: active.length,
            totalCompleted: completed.length,
            totalFailed: completed.filter((i: any) => i.status === 'FAILED').length,
        }
    };
});

// 8. Claim — User reveals secret to trigger claim flow
server.post('/claim', async (request, reply) => {
    const body = request.body as any;
    const { intentId, secret } = body;
    if (!intentId || !secret) {
        return reply.code(400).send({ error: 'Missing intentId or secret' });
    }

    const intent = relayer.getIntent(intentId);
    if (!intent) {
        return reply.code(404).send({ error: 'Intent not found' });
    }

    try {
        // Store the secret on the intent so the poll loop can complete the claim
        console.log("---- RECEIVING CLAIM ----\\nIntent Hashlock: ", intent.hashlock, "\\nClaim Secret: ", secret); (intent as any).secret = secret;
        console.log(chalk.cyan(`[Claim] Secret revealed for intent ${intentId}, triggering immediate processing`));

        // Trigger poll immediately for faster UX
        setTimeout(() => relayer.pollIntents(), 0);

        return {
            success: true,
            message: 'Secret accepted. Claim will be processed automatically.',
            intentId,
            status: intent.status,
        };
    } catch (e: any) {
        return reply.code(500).send({ error: e.message });
    }
});

const start = async () => {
    try {
        relayer = new BCHSolanaRelayerCore();
        await server.listen({ port: config.port, host: '0.0.0.0' });

        console.log(chalk.green(`\n🚀 BCH-Solana Relayer running on port ${config.port}`));
    } catch (err) {
        console.error(chalk.red('Failed to start server:'), err);
        process.exit(1);
    }
};

start();
