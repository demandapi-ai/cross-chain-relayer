
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

require('dotenv').config();

async function main() {
    const connection = new Connection('https://devnet.helius-rpc.com/?api-key=7ceb6609-616a-4e84-ba92-5ee3d04eb5e7', 'confirmed');

    // 1. Relayer Wallet (From .env)
    const relayerKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY || '[]'))
    );

    // 2. Deployer Wallet (Public Key)
    const deployerPubkey = new PublicKey("ghv6sY9W9B3zLKqDPWbQ8MYQvrRYvv4nsiQsxUyKsqW");

    console.log(`Relayer: ${relayerKeypair.publicKey.toBase58()}`);
    console.log(`Deployer: ${deployerPubkey.toBase58()}`);

    // Check balances
    const relayerBalance = await connection.getBalance(relayerKeypair.publicKey);
    const deployerBalance = await connection.getBalance(deployerPubkey);

    console.log(`Relayer Balance: ${relayerBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`Deployer Balance: ${deployerBalance / LAMPORTS_PER_SOL} SOL`);

    // Amount to transfer: 1.86 SOL (Safe margin, leaving ~0.1 for Relayer)
    const amount = 1.86 * LAMPORTS_PER_SOL;

    if (relayerBalance < amount) {
        console.error("Relayer has insufficient funds.");
        return;
    }

    console.log(`Transferring ${amount / LAMPORTS_PER_SOL} SOL to Deployer...`);

    const tx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: relayerKeypair.publicKey,
            toPubkey: deployerPubkey,
            lamports: amount,
        })
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [relayerKeypair]);
    console.log(`Transfer Success: ${sig}`);
}

main().then(() => console.log('Done')).catch(console.error);
