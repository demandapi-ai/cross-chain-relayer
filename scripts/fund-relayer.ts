import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Load .env manually to ensure we get the right one
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

async function main() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    const privateKeyString = process.env.SOLANA_PRIVATE_KEY;
    if (!privateKeyString) {
        throw new Error("SOLANA_PRIVATE_KEY not found in .env");
    }

    let secretKey: Uint8Array;
    try {
        secretKey = Uint8Array.from(JSON.parse(privateKeyString));
    } catch (e) {
        // Fallback for bs58 if needed (though we checked it's array)
        throw new Error("Invalid private key format. Expected JSON array.");
    }

    const keypair = Keypair.fromSecretKey(secretKey);
    const address = keypair.publicKey.toBase58();

    console.log("\n==================================================");
    console.log("🔑 Relayer Address:", address);
    console.log("==================================================\n");

    const initialBalance = await connection.getBalance(keypair.publicKey);
    console.log(`💰 Initial Balance: ${(initialBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

    console.log("🚰 Requesting 5 SOL Airdrop (in chunks)...");

    try {
        // Request 1: 2 SOL
        console.log("   Requesting 2 SOL...");
        const sig1 = await connection.requestAirdrop(keypair.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig1);
        console.log("   ✅ Received 2 SOL");

        // Request 2: 2 SOL
        console.log("   Requesting 2 SOL...");
        const sig2 = await connection.requestAirdrop(keypair.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig2);
        console.log("   ✅ Received 2 SOL");

        // Request 3: 1 SOL
        console.log("   Requesting 1 SOL...");
        const sig3 = await connection.requestAirdrop(keypair.publicKey, 1 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig3);
        console.log("   ✅ Received 1 SOL");

    } catch (error: any) {
        console.error("❌ Airdrop failed (Rate limit?):", error.message);
    }

    const finalBalance = await connection.getBalance(keypair.publicKey);
    console.log(`\n💰 Final Balance: ${(finalBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log("\n✅ Done!");
}

main().catch(console.error);
