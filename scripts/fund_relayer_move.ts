import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';
import * as dotenv from 'dotenv';
import chalk from 'chalk';
import * as path from 'path';

// Load .env
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

async function main() {
    console.log(chalk.cyan('🟣 Fund Relayer MOVE Script'));
    console.log(chalk.gray('─'.repeat(50)));

    const movPrivateKeyRaw = process.env.MOVEMENT_PRIVATE_KEY;
    if (!movPrivateKeyRaw) {
        throw new Error('Missing MOVEMENT_PRIVATE_KEY in .env');
    }

    const movRpcUrl = process.env.MOVEMENT_RPC_URL || 'https://testnet.movementnetwork.xyz/v1';
    console.log(chalk.blue(`🌐 RPC: ${movRpcUrl}`));

    // Initialize Aptos Client
    const aptosConfig = new AptosConfig({
        network: Network.CUSTOM,
        fullnode: movRpcUrl,
        faucet: 'https://faucet.testnet.movementnetwork.xyz' // Explicit faucet URL if needed, though SDK handles likely keys
    });
    const aptos = new Aptos(aptosConfig);

    // Get Account
    const privateKey = new Ed25519PrivateKey(movPrivateKeyRaw);
    const account = Account.fromPrivateKey({ privateKey });
    const address = account.accountAddress.toString();

    console.log(chalk.magenta('🔑 Relayer Address:'), chalk.whiteBright(address));

    // Check Initial Balance
    let initialBalance = 0;
    try {
        const resource = await aptos.getAccountResource({
            accountAddress: address,
            resourceType: "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
        });
        const data = resource as any;
        initialBalance = Number(data.coin.value) / 1e8;
        console.log(chalk.magenta(`💰 Initial Balance: ${initialBalance.toFixed(4)} MOVE`));
    } catch (e) {
        console.log(chalk.yellow('💰 Account not initialized or 0 balance.'));
    }

    const AMOUNT_MOVE = 100000;
    const amountOctas = AMOUNT_MOVE * 1e8;

    console.log(chalk.cyan(`\n🚰 Requesting ${AMOUNT_MOVE} MOVE from Faucet...`));

    try {
        // Use SDK faucet
        const txn = await aptos.fundAccount({
            accountAddress: address,
            amount: amountOctas
        });

        console.log(chalk.green('✅ Faucet request sent!'));
        console.log(chalk.gray(`   Wait response:`, txn));

    } catch (error: any) {
        console.error(chalk.red('❌ Faucet failed:'), error.message || error);
        console.log(chalk.yellow('   Note: The testnet faucet often has rate limits or max amount caps (e.g. 10 MOVE).'));
        console.log(chalk.yellow('   Try requesting a smaller amount if this failed.'));
    }

    // Check Final Balance
    let finalBalance = 0;
    try {
        const resource = await aptos.getAccountResource({
            accountAddress: address,
            resourceType: "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
        });
        const data = resource as any;
        finalBalance = Number(data.coin.value) / 1e8;
        console.log(chalk.magenta(`\n💰 Final Balance: ${finalBalance.toFixed(4)} MOVE`));
    } catch (e) {
        // Ignore
    }
}

main().catch(console.error);
