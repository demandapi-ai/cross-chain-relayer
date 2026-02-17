
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction, SystemProgram } from '@solana/web3.js';
import { TestNetWallet } from 'mainnet-js';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { config } from '../src/config';

// Ensure .env is loaded
import dotenv from 'dotenv';
dotenv.config();

const ENV_FILE = path.resolve(process.cwd(), '.env');

async function main() {
    console.log(chalk.blue('🔧 Setting up E2E Environment...'));

    // 1. Relayer Wallets (from .env or generated)
    // BCH
    const relayerBchCk = process.env.BCH_PRIVATE_KEY_WIF;
    const relayerBchWallet = await TestNetWallet.fromWIF(relayerBchCk || "");
    // If empty, TestNetWallet.fromId might be better or generate random.
    // Actually config.ts handles it. Let's rely on config defaults logic if specific logging needed?
    // But config.ts sets it to process.env.

    // Solana
    let relayerSolKeypair: Keypair;
    if (process.env.SOLANA_PRIVATE_KEY) {
        relayerSolKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY)));
    } else {
        relayerSolKeypair = Keypair.generate();
    }

    console.log(chalk.yellow('\n🤖 RELAYER WALLETS:'));
    console.log(`   BCH Address: ${relayerBchWallet.cashaddr}`);
    console.log(`   SOL Address: ${relayerSolKeypair.publicKey.toBase58()}`);

    // Print balances
    const bchBal = await relayerBchWallet.getBalance('sat');
    console.log(`   BCH Balance: ${bchBal} sats`);

    const connection = new Connection(config.solana.rpcUrl, 'confirmed');
    const solBal = await connection.getBalance(relayerSolKeypair.publicKey);
    console.log(`   SOL Balance: ${solBal / LAMPORTS_PER_SOL} SOL`);

    // Airdrop if low
    if (solBal < 1 * LAMPORTS_PER_SOL) {
        console.log(chalk.cyan('   💧 Airdropping 2 SOL to Relayer...'));
        try {
            const sig = await connection.requestAirdrop(relayerSolKeypair.publicKey, 2 * LAMPORTS_PER_SOL);
            await connection.confirmTransaction(sig);
            console.log(chalk.green('   ✅ Airdrop complete'));
        } catch (e: any) {
            console.log(chalk.red('   ❌ Airdrop failed (Rate limit?):'), e.message);
        }
    }

    // 2. User Wallets (Generate new for testing)
    // We will save these to a temp file or just log them?
    // Better to have stable user wallets for testing so we don't spam airdrops.
    // Let's check if .env.test exists? No.
    // Let's generating/loading a "test_user.json"

    console.log(chalk.yellow('\nDn👤 USER WALLETS (Test):'));
    const userKeyFile = 'user_keys.json';
    let userKeys: any = {};

    if (fs.existsSync(userKeyFile)) {
        userKeys = JSON.parse(fs.readFileSync(userKeyFile, 'utf-8'));
    }

    let userBchWallet: TestNetWallet;
    if (userKeys.bchWif) {
        userBchWallet = await TestNetWallet.fromWIF(userKeys.bchWif);
    } else {
        userBchWallet = await TestNetWallet.newRandom();
        userKeys.bchWif = userBchWallet.privateKeyWif;
    }

    let userSolKeypair: Keypair;
    if (userKeys.solSecret) {
        userSolKeypair = Keypair.fromSecretKey(Uint8Array.from(userKeys.solSecret));
    } else {
        userSolKeypair = Keypair.generate();
        userKeys.solSecret = Array.from(userSolKeypair.secretKey);
    }

    // Save
    fs.writeFileSync(userKeyFile, JSON.stringify(userKeys, null, 2));

    console.log(`   BCH Address: ${userBchWallet.cashaddr}`);
    console.log(`   SOL Address: ${userSolKeypair.publicKey.toBase58()}`);

    // Check balances
    const userBchBal = await userBchWallet.getBalance('sat');
    console.log(`   BCH Balance: ${userBchBal} sats`);

    const userSolBal = await connection.getBalance(userSolKeypair.publicKey);
    console.log(`   SOL Balance: ${userSolBal / LAMPORTS_PER_SOL} SOL`);

    // Fund User from Relayer if User is low and Relayer has funds
    if (userBchBal < 10000 && bchBal > 50000) {
        console.log(chalk.cyan('   💸 Relayer sending 20000 sats to User...'));
        try {
            await relayerBchWallet.send([
                { cashaddr: userBchWallet.cashaddr!, value: 20000, unit: 'sat' }
            ]);
            console.log(chalk.green('   ✅ BCH Sent'));
        } catch (e: any) {
            console.error(chalk.red('   ❌ BCH Send Failed:'), e.message);
        }
    }

    if (userSolBal < 0.1 * LAMPORTS_PER_SOL && solBal > 1 * LAMPORTS_PER_SOL) {
        console.log(chalk.cyan('   💸 Relayer sending 1 SOL to User...'));
        try {
            const transferTx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: relayerSolKeypair.publicKey,
                    toPubkey: userSolKeypair.publicKey,
                    lamports: 1 * LAMPORTS_PER_SOL
                })
            );
            await connection.sendTransaction(transferTx, [relayerSolKeypair]);
            // Wait for confirm?
            console.log(chalk.green('   ✅ SOL Sent (Wait a sec for confirmation)'));
            await new Promise(r => setTimeout(r, 2000));
        } catch (e: any) {
            console.log(chalk.red('   ❌ SOL Send Failed:'), e.message);
        }
    }

    // Write Relayer Keys to .env if missing
    if (!process.env.BCH_PRIVATE_KEY_WIF) {
        console.log(chalk.magenta('\n📝 Updating .env with Relayer BCH Key...'));
        fs.appendFileSync(ENV_FILE, `\nBCH_PRIVATE_KEY_WIF=${relayerBchWallet.privateKeyWif}`);
    }
    if (!process.env.SOLANA_PRIVATE_KEY) {
        console.log(chalk.magenta('📝 Updating .env with Relayer SOL Key...'));
        fs.appendFileSync(ENV_FILE, `\nSOLANA_PRIVATE_KEY=${JSON.stringify(Array.from(relayerSolKeypair.secretKey))}`);
    }

    console.log(chalk.green('\n✅ Setup Complete! Ready for E2E Tests.'));
}

main().catch(console.error);
