import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, NATIVE_MINT } from '@solana/spl-token';
import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';
import * as dotenv from 'dotenv';
import chalk from 'chalk';
import * as path from 'path';

// Load .env
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

async function main() {
    console.log(chalk.cyan('Running Relayer Balance Check...'));
    console.log(chalk.gray('─'.repeat(50)));

    // ================= SOLANA =================
    const solPrivateKeyRaw = process.env.SOLANA_PRIVATE_KEY;
    if (!solPrivateKeyRaw) throw new Error('Missing SOLANA_PRIVATE_KEY in .env');

    let solSecretKey: Uint8Array;
    try {
        solSecretKey = Uint8Array.from(JSON.parse(solPrivateKeyRaw));
    } catch {
        throw new Error('Invalid SOLANA_PRIVATE_KEY format in .env');
    }

    const solKeypair = Keypair.fromSecretKey(solSecretKey);
    const solAddress = solKeypair.publicKey.toBase58();

    console.log(chalk.cyan('🔑 Solana Relayer:'), chalk.whiteBright(solAddress));

    const solRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const solConnection = new Connection(solRpcUrl, 'confirmed');

    // 1. Check Native SOL Balance
    const balanceLamports = await solConnection.getBalance(solKeypair.publicKey);
    const solBalance = balanceLamports / LAMPORTS_PER_SOL;

    // 2. Check WSOL Balance
    const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, solKeypair.publicKey);
    let wsolBalance = 0;

    try {
        const accountInfo = await getAccount(solConnection, wsolAta);
        wsolBalance = Number(accountInfo.amount) / LAMPORTS_PER_SOL;
    } catch (e) {
        // ATA likely doesn't exist
    }

    console.log(chalk.green('💰 Native SOL:'), chalk.bold(`${solBalance.toFixed(4)} SOL`));
    console.log(chalk.blue('🪙  Wrapped SOL:'), chalk.bold(`${wsolBalance.toFixed(4)} WSOL`));

    console.log(chalk.gray('─'.repeat(50)));

    // ================= MOVEMENT =================
    const movPrivateKeyRaw = process.env.MOVEMENT_PRIVATE_KEY;
    if (!movPrivateKeyRaw) {
        console.log(chalk.yellow('⚠️  MOVEMENT_PRIVATE_KEY not found. Skipping Movement check.'));
    } else {
        const movRpcUrl = process.env.MOVEMENT_RPC_URL || 'https://testnet.movementnetwork.xyz/v1';
        const aptosConfig = new AptosConfig({
            network: Network.CUSTOM,
            fullnode: movRpcUrl,
        });
        const aptos = new Aptos(aptosConfig);

        const privateKey = new Ed25519PrivateKey(movPrivateKeyRaw);
        const movAccount = Account.fromPrivateKey({ privateKey });
        const movAddress = movAccount.accountAddress.toString();

        console.log(chalk.magenta('🔑 Movement Relayer:'), chalk.whiteBright(movAddress));

        let moveBalance = 0;
        try {
            const resource = await aptos.getAccountResource({
                accountAddress: movAddress,
                resourceType: "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
            });
            const data = resource as any;
            moveBalance = Number(data.coin.value) / 1e8; // MOVE has 8 decimals
        } catch (e) {
            // Likely no balance or account not found
        }

        console.log(chalk.magenta('🟣 MOVE Balance:'), chalk.bold(`${moveBalance.toFixed(4)} MOVE`));
    }

    console.log(chalk.gray('─'.repeat(50)));
}

main().catch(console.error);
