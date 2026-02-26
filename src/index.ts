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
    // Required: makerAddress, recipientAddress, sellAmount, buyAmount, hashlock, bchContractAddress
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
