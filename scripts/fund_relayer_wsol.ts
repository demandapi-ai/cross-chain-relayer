/**
 * Fund Relayer WSOL Account
 * 
 * This script wraps native SOL into WSOL for the relayer's token account.
 * The relayer needs WSOL to fulfill MOV→SOL swaps.
 * 
 * Usage: npx ts-node scripts/fund_relayer_wsol.ts
 */

import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction
} from '@solana/web3.js';
import {
    NATIVE_MINT,
    getAssociatedTokenAddress,
    createSyncNativeInstruction,
    getAccount,
    createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import * as dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

const WRAP_AMOUNT_SOL = 2.0; // Amount of SOL to wrap into WSOL

async function main() {
    console.log(chalk.cyan('🔄 Fund Relayer WSOL Script'));
    console.log(chalk.gray('─'.repeat(50)));

    // Load relayer keypair from env
    const privateKeyRaw = process.env.SOLANA_PRIVATE_KEY;
    if (!privateKeyRaw) {
        throw new Error('Missing SOLANA_PRIVATE_KEY in .env');
    }

    const relayerKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(privateKeyRaw))
    );

    console.log(chalk.blue(`📍 Relayer Address: ${relayerKeypair.publicKey.toBase58()}`));

    // Connect to Solana
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // Get native SOL balance
    const solBalance = await connection.getBalance(relayerKeypair.publicKey);
    console.log(chalk.blue(`💰 Native SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`));

    if (solBalance < WRAP_AMOUNT_SOL * LAMPORTS_PER_SOL + 0.01 * LAMPORTS_PER_SOL) {
        throw new Error(`Insufficient SOL. Need at least ${WRAP_AMOUNT_SOL + 0.01} SOL`);
    }

    // Get WSOL ATA address
    const wsolAta = await getAssociatedTokenAddress(
        NATIVE_MINT,
        relayerKeypair.publicKey
    );
    console.log(chalk.blue(`🪙  WSOL ATA: ${wsolAta.toBase58()}`));

    // Check if ATA exists
    let ataExists = false;
    try {
        const accountInfo = await getAccount(connection, wsolAta);
        ataExists = true;
        console.log(chalk.yellow(`📊 Current WSOL Balance: ${Number(accountInfo.amount) / LAMPORTS_PER_SOL} WSOL`));
    } catch (e) {
        console.log(chalk.yellow('📊 WSOL ATA does not exist, will create it'));
    }

    // Build transaction
    const tx = new Transaction();

    // Create ATA if it doesn't exist
    if (!ataExists) {
        tx.add(
            createAssociatedTokenAccountInstruction(
                relayerKeypair.publicKey, // payer
                wsolAta,                   // ata
                relayerKeypair.publicKey,  // owner
                NATIVE_MINT                // mint
            )
        );
    }

    // Transfer SOL to WSOL account
    const wrapAmountLamports = WRAP_AMOUNT_SOL * LAMPORTS_PER_SOL;
    tx.add(
        SystemProgram.transfer({
            fromPubkey: relayerKeypair.publicKey,
            toPubkey: wsolAta,
            lamports: wrapAmountLamports
        })
    );

    // Sync native instruction to update token balance
    tx.add(
        createSyncNativeInstruction(wsolAta)
    );

    console.log(chalk.cyan(`\n⏳ Wrapping ${WRAP_AMOUNT_SOL} SOL into WSOL...`));

    // Send transaction
    const signature = await sendAndConfirmTransaction(connection, tx, [relayerKeypair]);
    console.log(chalk.green(`✅ Transaction confirmed: ${signature}`));

    // Verify new balance
    const newAccount = await getAccount(connection, wsolAta);
    console.log(chalk.green(`🪙  New WSOL Balance: ${Number(newAccount.amount) / LAMPORTS_PER_SOL} WSOL`));

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.green('🎉 Relayer WSOL funded successfully!'));
}

main().catch(console.error);
