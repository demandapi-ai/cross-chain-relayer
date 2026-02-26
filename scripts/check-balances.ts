import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { TestNetWallet } from 'mainnet-js';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { config, TOKENS } from '../src/config';
import { MovementService } from '../src/services/MovementService';
import { Ed25519PrivateKey, Account } from '@aptos-labs/ts-sdk';

import dotenv from 'dotenv';
dotenv.config();

async function checkSolanaUSDC(connection: Connection, owner: PublicKey, label: string) {
    try {
        const usdcMint = new PublicKey(TOKENS.solana.USDC);
        const ata = await getAssociatedTokenAddress(usdcMint, owner);
        const { value } = await connection.getTokenAccountBalance(ata);
        console.log(`   [${label}] Solana USDC: ${value.uiAmount} (ATA: ${ata.toBase58()})`);
    } catch (e: any) {
        console.log(chalk.gray(`   [${label}] Solana USDC: 0 (No ATA found)`));
    }
}

async function main() {
    console.log(chalk.blue('🔍 Checking USDC and MOVE Balances...\n'));

    // --- RELAYER ---
    let relayerMovAccount: Account | null = null;
    let relayerSolPubkey: PublicKey | null = null;

    if (process.env.MOVEMENT_PRIVATE_KEY) {
        const privateKey = new Ed25519PrivateKey(process.env.MOVEMENT_PRIVATE_KEY);
        relayerMovAccount = Account.fromPrivateKey({ privateKey });

        // Setup movement service for relayer to check balance
        const relayerMovService = new MovementService();
        const balances = await relayerMovService.getBalances();
        console.log(chalk.yellow('🤖 RELAYER (Movement):'));
        console.log(`   Address: ${relayerMovAccount.accountAddress.toString()}`);
        balances.forEach(b => console.log(`   ${b.symbol}: ${b.balance}`));
    }

    if (process.env.SOLANA_PRIVATE_KEY) {
        // Load Solana Relayer
        const secretKey = Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY));
        const keypair = Keypair.fromSecretKey(secretKey);
        relayerSolPubkey = keypair.publicKey;

        console.log(chalk.yellow('\n🤖 RELAYER (Solana):'));
        console.log(`   Address: ${relayerSolPubkey.toBase58()}`);
        const connection = new Connection(config.solana.rpcUrl, 'confirmed');
        await checkSolanaUSDC(connection, relayerSolPubkey, 'Relayer');
    }

    // --- USER ---
    const userKeyFile = 'user_keys.json';
    if (fs.existsSync(userKeyFile)) {
        const userKeys = JSON.parse(fs.readFileSync(userKeyFile, 'utf-8'));

        if (userKeys.movSecret) {
            const privateKey = new Ed25519PrivateKey(userKeys.movSecret);
            const userMovAccount = Account.fromPrivateKey({ privateKey });

            // Temporary service purely for balance fetching
            process.env.MOVEMENT_PRIVATE_KEY = userKeys.movSecret;
            const userMovService = new MovementService();
            const balances = await userMovService.getBalances();

            console.log(chalk.cyan('\n👤 USER (Movement):'));
            console.log(`   Address: ${userMovAccount.accountAddress.toString()}`);
            balances.forEach(b => console.log(`   ${b.symbol}: ${b.balance}`));
        }

        if (userKeys.solSecret) {
            const secretKey = Uint8Array.from(userKeys.solSecret);
            const keypair = Keypair.fromSecretKey(secretKey);

            console.log(chalk.cyan('\n👤 USER (Solana):'));
            console.log(`   Address: ${keypair.publicKey.toBase58()}`);
            const connection = new Connection(config.solana.rpcUrl, 'confirmed');
            await checkSolanaUSDC(connection, keypair.publicKey, 'User');
        }
    } else {
        console.log(chalk.gray('\n   (No user_keys.json found)'));
    }

    console.log(chalk.green('\n✅ Balance check complete.'));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
