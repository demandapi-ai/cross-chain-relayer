import fastify from 'fastify';
import cors from '@fastify/cors';
import chalk from 'chalk';
import { config } from './config';
import { BCHSolanaRelayerCore } from './services/BCHSolanaRelayerCore';

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
        const intent = await relayer.handleBCHToSolana(body);
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

// 6. Manual Secret Reveal (Optional, usually auto-detected)
server.post('/reveal-secret', async (request, reply) => {
    // In this architecture, we poll for secrets. 
    // But helpful for debugging or forcing completion.
    // TODO: Implement manual override if needed.
    return { message: "Relayer polls for secrets automatically." };
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
