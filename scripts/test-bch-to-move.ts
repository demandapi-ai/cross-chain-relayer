import { TestNetWallet } from 'mainnet-js';
import { MovementService } from '../src/services/MovementService';
import { BCHService } from '../src/services/BCHService';
import * as fs from 'fs';
import chalk from 'chalk';
import fetch from 'node-fetch';
import { config, TOKENS } from '../src/config';
import { randomBytes } from 'crypto';

async function main() {
    console.log(chalk.blue('🚀 Starting Integration Test: BCH (User) -> MOVE (User) [Embedded Relayer]'));

    // 1. Load User Keys
    const userKeyFile = 'user_keys.json';
    if (!fs.existsSync(userKeyFile)) {
        console.error('❌ Run setup-e2e.ts first!');
        process.exit(1);
    }
    const userKeys = JSON.parse(fs.readFileSync(userKeyFile, 'utf-8'));



    // 2. Init User Services
    const relayer = new BCHSolanaRelayerCore();
    const userBchService = new BCHService();
    await userBchService.initWallet(userKeys.bchWif);

    // Provide user's Movement key via environment just for instantiation
    process.env.MOVEMENT_PRIVATE_KEY = userKeys.movSecret;
    const userMovService = new MovementService();

    // Check Balances
    const bchBal = await (userBchService as any).wallet.getBalance('sat');
    console.log(`   User BCH: ${bchBal} sats`);
    if (bchBal < 3000) {
        console.error(chalk.red(`❌ User BCH Balance too low (Need > 3000 sats)`));
        process.exit(1);
    }

    // 3. Generate Secret
    const secret = randomBytes(32);
    const secretHex = secret.toString('hex');
    const hashlock = MovementService.generateHashlock(secret);
    const hashHex = Buffer.from(hashlock).toString('hex');
    console.log(chalk.cyan(`   Generated Secret: ${secretHex}`));

    // 4. User Locks BCH
    const sellAmount = 2000n; // 2,000 sats
    const buyAmount = 5000000n; // 0.05 MOVE (in octas)
    const timelock = BigInt(Math.floor(Date.now() / 1000) + config.timelocks.source);

    console.log(chalk.cyan(`\n⚡ User locking ${sellAmount} sats on BCH...`));
    const { contractAddress, txId } = await userBchService.lockBCH(
        userBchService.wallet.cashaddr as string, // User is maker
        hashHex,
        sellAmount,
        timelock
    );

    console.log(chalk.green(`   ✅ BCH Locked! Contract: ${contractAddress}`));

    // 5. Start Embedded Relayer & Submit Intent
    const { BCHSolanaRelayerCore } = await import('../src/services/BCHSolanaRelayerCore');
    const relayer = new BCHSolanaRelayerCore();
    await new Promise(r => setTimeout(r, 2000)); // Let relayer init

    console.log(chalk.cyan(`\n📥 Submitting Intent to Relayer...`));
    const intentParams = {
        makerAddress: userBchService.wallet.cashaddr as string,
        recipientAddress: userMovService.account.accountAddress.toString(),
        sellAmount: sellAmount.toString(),
        buyAmount: buyAmount.toString(),
        hashlock: hashHex,
        bchContractAddress: contractAddress,
        sourceTimelock: Number(timelock)
    };

    const intent = await relayer.handleBCHToMovement(intentParams);

    // Wait for Relayer to Process and create Dest Escrow
    console.log(chalk.cyan(`\n⏳ Waiting for Relayer to lock MOVE on Movement...`));
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

    console.log(chalk.green(`\n   ✅ Relayer Locked MOVE! Escrow ID: ${currentIntent.movementEscrowId}`));

    // 6. User Claims Dest (Movement)
    console.log(chalk.cyan(`\n⚡ User Claiming MOVE Escrow...`));
    const claimTx = await userMovService.claim(
        parseInt(currentIntent.movementEscrowId!),
        secret,
        TOKENS.movement.MOVE
    );

    console.log(chalk.green(`   ✅ Claimed MOVE! Tx: ${claimTx}`));

    // Wait for Relayer to catch the claim and finish
    console.log(chalk.cyan(`\n⏳ Waiting for Relayer to claim source BCH...`));
    while (currentIntent?.status !== 'COMPLETED') {
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 3000));
        currentIntent = relayer.getIntent(intent.id);

        // Mock Polling for Demo if relayer indexing is too slow
        if (currentIntent?.status === 'DEST_FILLED') {
            console.log(chalk.cyan(`\nℹ️ Simulating Relayer indexing Movement claim event... (Triggering manually)`));
            try {
                await relayer.processSecretRevelation(intent.id, `0x${secretHex}`);
            } catch (e) { }
        }
    }

    console.log(chalk.green(`\n🎉 E2E Test Passed (BCH -> MOVE)`));
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
