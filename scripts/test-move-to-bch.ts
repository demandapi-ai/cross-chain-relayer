import { TestNetWallet } from 'mainnet-js';
import { MovementService } from '../src/services/MovementService';
import { BCHService } from '../src/services/BCHService';
import * as fs from 'fs';
import chalk from 'chalk';
import fetch from 'node-fetch';
import { config, TOKENS } from '../src/config';
import { randomBytes } from 'crypto';

async function main() {
    console.log(chalk.blue('🚀 Starting Integration Test: MOVE (User) -> BCH (User) [Embedded Relayer]'));

    // 1. Load User Keys
    const userKeyFile = 'user_keys.json';
    if (!fs.existsSync(userKeyFile)) {
        console.error('❌ Run setup-e2e.ts first!');
        process.exit(1);
    }
    const userKeys = JSON.parse(fs.readFileSync(userKeyFile, 'utf-8'));

    // 2. Init User Services
    const userBchService = new BCHService();
    await userBchService.initWallet(userKeys.bchWif);

    process.env.MOVEMENT_PRIVATE_KEY = userKeys.movSecret;
    const userMovService = new MovementService();

    // Check Balances
    const moveBal = await userMovService.getBalances();
    const hasMove = moveBal.find(b => b.symbol === 'MOVE');
    console.log(`   User MOVE: ${hasMove?.balance || 0} MOVE`);

    // We need 0.05 MOVE (5,000,000 octas)
    if (!hasMove || hasMove.balance < 0.05) {
        console.error(chalk.red(`❌ User MOVE Balance too low (Need > 0.05 MOVE)`));
        process.exit(1);
    }

    // 3. Generate Secret
    const secret = randomBytes(32);
    const secretHex = secret.toString('hex');
    const hashlock = MovementService.generateHashlock(secret);
    const hashHex = Buffer.from(hashlock).toString('hex');
    console.log(chalk.cyan(`   Generated Secret: ${secretHex}`));

    // 4. User Locks MOVE
    const sellAmount = 5000000n; // 0.05 MOVE (in octas)
    const buyAmount = 10000n; // 10,000 sats
    const timelock = config.timelocks.movement;

    console.log(chalk.cyan(`\n⚡ User locking ${sellAmount} octas on Movement...`));

    // Using Relayer address as recipient on Movement
    // Notice: we need Relayer Movement public key here
    const { MovementService: RelayerMovementService } = await import('../src/services/MovementService');
    const tempRelayerMov = new RelayerMovementService(); // Will load from .env

    const { escrowId } = await userMovService.createEscrow(
        hashlock,
        tempRelayerMov.account.accountAddress.toString(),
        sellAmount,
        timelock,
        TOKENS.movement.MOVE
    );

    console.log(chalk.green(`   ✅ MOVE Locked! Escrow ID: ${escrowId}`));

    // 5. Start Embedded Relayer & Submit Intent
    const { BCHSolanaRelayerCore } = await import('../src/services/BCHSolanaRelayerCore');
    const relayer = new BCHSolanaRelayerCore();
    await new Promise(r => setTimeout(r, 2000)); // Let relayer init

    console.log(chalk.cyan(`\n📥 Submitting Intent to Relayer...`));
    const intentParams = {
        makerAddress: userMovService.account.accountAddress.toString(),
        recipientAddress: userBchService.wallet.cashaddr as string,
        sellAmount: sellAmount.toString(),
        buyAmount: buyAmount.toString(),
        hashlock: hashHex,
        sourceEscrowId: escrowId.toString()
    };

    const intent = await relayer.handleMovementToBCH(intentParams);

    // Wait for Relayer to Process and create Dest Escrow
    console.log(chalk.cyan(`\n⏳ Waiting for Relayer to lock BCH...`));
    let currentIntent = relayer.getIntent(intent.id);
    while (currentIntent?.status !== 'DEST_FILLED') {
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 3000));
        currentIntent = relayer.getIntent(intent.id);
        if (currentIntent?.status === 'FAILED') {
            console.error(chalk.red(`\n❌ Relayer Failed\n`));
            process.exit(1);
        }
    }

    console.log(chalk.green(`\n   ✅ Relayer Locked BCH! Contract: ${currentIntent.bchContractAddress}`));

    // 6. User Claims Dest (BCH)
    console.log(chalk.cyan(`\n⚡ User Claiming BCH Contract...`));
    const claimTx = await userBchService.claimHTLC(
        userBchService.wallet.cashaddr as string,
        hashHex,
        secretHex,
        BigInt(currentIntent.destTimelock)
    );

    console.log(chalk.green(`   ✅ Claimed BCH! Tx: ${claimTx}`));

    // Wait for Relayer to catch the claim and finish
    console.log(chalk.cyan(`\n⏳ Waiting for Relayer to claim source MOVE...`));
    while (currentIntent?.status !== 'COMPLETED') {
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 3000));
        currentIntent = relayer.getIntent(intent.id);
    }

    console.log(chalk.green(`\n🎉 E2E Test Passed (MOVE -> BCH)`));
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
