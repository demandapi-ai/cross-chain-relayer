import fastify from 'fastify';
import cors from '@fastify/cors';
import chalk from 'chalk';
import { config } from './config';
import { RelayerCore } from './services/RelayerCore';

const server = fastify({ logger: false });
server.register(cors, { origin: true });

let relayer: RelayerCore;

// Health endpoint
server.get('/health', async () => {
    const health = await relayer.getHealth();
    return {
        status: 'ok',
        ...health,
    };
});

// Get active orders
server.get('/orders', async () => {
    return {
        active: relayer.getActiveIntents(),
        completed: relayer.getCompletedIntents().slice(-20), // Last 20
    };
});

// Get specific intent status
server.get('/intents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const intent = relayer.getIntent(id);

    if (!intent) {
        return reply.code(404).send({ error: 'Intent not found' });
    }

    return { intent };
});

// Movement → Solana swap
server.post('/swap/movement-to-solana', async (request, reply) => {
    const body = request.body as any;

    if (!body.makerAddress || !body.recipientAddress || !body.sellAmount || !body.buyAmount || !body.hashlock) {
        return reply.code(400).send({
            error: 'Missing required fields: makerAddress, recipientAddress, sellAmount, buyAmount, hashlock',
        });
    }

    try {
        const intent = await relayer.handleMovementToSolana({
            makerAddress: body.makerAddress,
            recipientAddress: body.recipientAddress,
            sellAmount: body.sellAmount,
            buyAmount: body.buyAmount,
            hashlock: body.hashlock,
            sourceEscrowId: body.sourceEscrowId || 0,
            signature: body.signature || "0x" + "00".repeat(64), // Fallback for test if needed
            intent: body.intent || {}
        });

        return { success: true, intent };
    } catch (error: any) {
        console.error(chalk.red('Swap failed:'), error);
        return reply.code(500).send({ error: error.message });
    }
});

// Solana → Movement swap
server.post('/swap/solana-to-movement', async (request, reply) => {
    const body = request.body as any;

    if (!body.makerAddress || !body.recipientAddress || !body.sellAmount || !body.buyAmount || !body.hashlock) {
        return reply.code(400).send({
            error: 'Missing required fields: makerAddress, recipientAddress, sellAmount, buyAmount, hashlock',
        });
    }

    try {
        const intent = await relayer.handleSolanaToMovement({
            makerAddress: body.makerAddress,
            recipientAddress: body.recipientAddress,
            sellAmount: body.sellAmount,
            buyAmount: body.buyAmount,
            hashlock: body.hashlock,
            sourceEscrowPda: body.sourceEscrowPda,
        });

        return { success: true, intent };
    } catch (error: any) {
        console.error(chalk.red('Swap failed:'), error);
        return reply.code(500).send({ error: error.message });
    }
});

// Process secret revelation (for settlement)
server.post('/reveal-secret', async (request, reply) => {
    const body = request.body as any;

    if (!body.intentId || !body.secret) {
        return reply.code(400).send({ error: 'Missing intentId or secret' });
    }

    try {
        await relayer.processSecretRevelation(body.intentId, body.secret);
        return { success: true, message: 'Secret processed, cross-chain swap completed' };
    } catch (error: any) {
        return reply.code(500).send({ error: error.message });
    }
});

// Request faucet drip
server.post('/request-faucet', async (request, reply) => {
    const body = request.body as any;

    if (!body.chain || !body.address) {
        return reply.code(400).send({ error: 'Missing chain or address' });
    }

    try {
        const txHash = await relayer.handleFaucetRequest(body.chain, body.address);
        return { success: true, txHash };
    } catch (error: any) {
        console.error(chalk.red('Faucet request failed:'), error.message);
        return reply.code(500).send({ error: error.message });
    }
});

// Start server
const start = async () => {
    try {
        // Initialize relayer
        relayer = new RelayerCore();

        // Start server
        await server.listen({ port: config.port, host: '0.0.0.0' });

        console.log(chalk.green(`\n🚀 Cross-Chain Relayer running on port ${config.port}`));
        console.log(chalk.cyan(`   Movement RPC: ${config.movement.rpcUrl}`));
        console.log(chalk.magenta(`   Solana RPC: ${config.solana.rpcUrl}`));

        // Log health
        const health = await relayer.getHealth();
        console.log(chalk.blue(`\n💰 Relayer Balances:`));
        console.log(chalk.blue(`   Movement (${health.movement.address.slice(0, 10)}...):`));
        health.movement.balances.forEach(b => {
            console.log(chalk.blue(`      ${b.symbol}: ${b.balance.toFixed(4)}`));
        });
        console.log(chalk.magenta(`   Solana (${health.solana.address.slice(0, 10)}...):`));
        health.solana.balances.forEach(b => {
            console.log(chalk.magenta(`      ${b.symbol}: ${b.balance.toFixed(4)}`));
        });

    } catch (err) {
        console.error(chalk.red('Failed to start server:'), err);
        process.exit(1);
    }
};

start();
