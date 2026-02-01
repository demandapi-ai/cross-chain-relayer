
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

require('dotenv').config();

async function main() {
    const connection = new Connection('https://devnet.helius-rpc.com/?api-key=7ceb6609-616a-4e84-ba92-5ee3d04eb5e7', 'confirmed');

    // 1. Relayer Wallet (From .env)
    const relayerKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY || '[]'))
    );

    // 2. User Wallet
    const userWalletDir = path.resolve(__dirname, '../../test-wallets');
    if (!fs.existsSync(userWalletDir)) {
        fs.mkdirSync(userWalletDir, { recursive: true });
    }
    const userWalletPath = path.join(userWalletDir, 'user-solana.json');

    let userKeypair: Keypair;
    if (fs.existsSync(userWalletPath)) {
        userKeypair = Keypair.fromSecretKey(
            new Uint8Array(JSON.parse(fs.readFileSync(userWalletPath, 'utf-8')))
        );
    } else {
        console.log("Generating new User Wallet...");
        userKeypair = Keypair.generate();
        fs.writeFileSync(userWalletPath, JSON.stringify(Array.from(userKeypair.secretKey)));
    }
    const userPubkey = userKeypair.publicKey;

    console.log(`Relayer: ${relayerKeypair.publicKey.toBase58()}`);
    console.log(`User: ${userPubkey.toBase58()}`);

    // Check balances
    const relayerBalance = await connection.getBalance(relayerKeypair.publicKey);
    const userBalance = await connection.getBalance(userPubkey);

    console.log(`Relayer Balance: ${relayerBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`User Balance: ${userBalance / LAMPORTS_PER_SOL} SOL`);

    if (relayerBalance < 0.5 * LAMPORTS_PER_SOL) {
        console.error("Relayer has insufficient funds to fund user.");
        return;
    }

    // Transfer 0.5 SOL
    const amount = 0.5 * LAMPORTS_PER_SOL;
    console.log(`Transferring ${amount / LAMPORTS_PER_SOL} SOL to User...`);

    const tx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: relayerKeypair.publicKey,
            toPubkey: userPubkey,
            lamports: amount,
        })
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [relayerKeypair]);
    console.log(`Transfer Success: ${sig}`);
}

main().then(() => console.log('Done')).catch(console.error);
