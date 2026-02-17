import { BCHService } from '../src/services/BCHService';
import { randomBytes, createHash } from 'crypto';
import chalk from 'chalk';

async function main() {
    console.log(chalk.blue('🚀 Deploying Test HTLC on Chipnet...'));

    // 1. Generate Secret
    const secret = randomBytes(32);
    const secretHex = secret.toString('hex');
    const hash = createHash('sha256').update(secret).digest();
    const hashHex = hash.toString('hex');

    console.log(chalk.yellow(`   Secret: 0x${secretHex}`));
    console.log(chalk.yellow(`   Hash:   0x${hashHex}`));

    // 2. Init Service
    const bchService = new BCHService();
    await bchService.initWallet();

    if (!bchService.wallet) {
        console.error("Wallet failed to init");
        process.exit(1);
    }

    // 3. User Address (Self)
    const userAddr = bchService.wallet.cashaddr;

    // 4. Deploy & Fund (10000 sats)
    const amount = 10000n;
    const timelock = BigInt(Math.floor(Date.now() / 1000) + 7200); // 2 hours

    console.log(chalk.cyan(`   Locking ${amount} sats for 2 hours...`));

    try {
        const result = await bchService.lockBCH(
            userAddr,
            hashHex,
            amount,
            timelock
        );

        console.log(chalk.green(`\n✅ HTLC Deployed!`));
        console.log(chalk.green(`   Address: ${result.contractAddress}`));
        console.log(chalk.green(`   TxID:    ${result.txId}`));

        console.log(chalk.gray(`\n   You can now use this to test BCH->SOL swap:`));
        console.log(chalk.gray(`   POST /swap/bch-to-solana`));
        console.log(chalk.gray(`   {`));
        console.log(chalk.gray(`     "makerAddress": "${userAddr}",`));
        console.log(chalk.gray(`     "recipientAddress": "<YOUR_SOL_ADDR>",`));
        console.log(chalk.gray(`     "sellAmount": "${amount}",`));
        console.log(chalk.gray(`     "buyAmount": "10000000",`));
        console.log(chalk.gray(`     "hashlock": "0x${hashHex}",`));
        console.log(chalk.gray(`     "bchContractAddress": "${result.contractAddress}"`));
        console.log(chalk.gray(`   }`));

    } catch (e: any) {
        console.error(chalk.red('Deployment failed:'), e.message);
    }
}

main();
