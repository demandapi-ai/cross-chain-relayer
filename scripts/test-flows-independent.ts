import { TestNetWallet } from 'mainnet-js';
import { MovementService } from '../src/services/MovementService';
import { BCHService } from '../src/services/BCHService';
import * as fs from 'fs';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import { config, TOKENS } from '../src/config';

dotenv.config();

async function main() {
    console.log(chalk.blue('============== CROSS-CHAIN INDEPENDENT TESTS =============='));

    // 1. Load User Keys
    const userKeyFile = 'user_keys.json';
    if (!fs.existsSync(userKeyFile)) {
        console.error('❌ Run setup-e2e.ts first!');
        process.exit(1);
    }
    const userKeys = JSON.parse(fs.readFileSync(userKeyFile, 'utf-8'));

    // 2. Initialize User Services
    const userBchService = new BCHService();
    await userBchService.initWallet(userKeys.bchWif);

    // We override process.env for the user service to instantiate correctly
    const originalMovKey = process.env.MOVEMENT_PRIVATE_KEY;
    process.env.MOVEMENT_PRIVATE_KEY = userKeys.movSecret;
    const userMovService = new MovementService();

    // 3. Initialize Relayer Services
    process.env.MOVEMENT_PRIVATE_KEY = originalMovKey; // restore relayer key
    const relayerBchService = new BCHService();
    await relayerBchService.initWallet(process.env.BCH_NODE_WIF!);
    const relayerMovService = new MovementService();

    const userBchAddress = userBchService.wallet.cashaddr as string;
    const userMovAddress = userMovService.account.accountAddress.toString();
    const relayerBchAddress = relayerBchService.wallet.cashaddr as string;
    const relayerMovAddress = relayerMovService.account.accountAddress.toString();

    console.log(chalk.gray(`\nActors:`));
    console.log(chalk.gray(`  User BCH:    ${userBchAddress}`));
    console.log(chalk.gray(`  User MOVE:   ${userMovAddress}`));
    console.log(chalk.gray(`  Relayer BCH: ${relayerBchAddress}`));
    console.log(chalk.gray(`  Relayer MOV: ${relayerMovAddress}\n`));

    // =====================================================================
    // FLOW 1: BCH -> MOVEMENT
    // =====================================================================
    console.log(chalk.magenta('==========================================================='));
    console.log(chalk.magenta('  FLOW 1: BCH -> MOVEMENT'));
    console.log(chalk.magenta('==========================================================='));

    // Check User BCH Balance
    let userBchBal = await (userBchService as any).wallet.getBalance('sat');
    console.log(`User BCH Balance: ${userBchBal} sats`);
    if (userBchBal < 10000) {
        console.error(chalk.red(`❌ User needs at least 10000 sats to test BCH -> MOV.`));
        return;
    }

    // 1.1 Generate Secret
    let secret = randomBytes(32);
    let secretHex = secret.toString('hex');
    let hashlock = MovementService.generateHashlock(secret);
    let hashHex = Buffer.from(hashlock).toString('hex');
    console.log(`[1] Secret Generated: ${secretHex}, Hash: ${hashHex}`);

    // 1.2 User Locks BCH
    let bchTimelock = BigInt(Math.floor(Date.now() / 1000) + config.timelocks.source);
    let sellAmountBch = 5000n;
    console.log(`[2] User locking ${sellAmountBch} sats on BCH for Relayer...`);
    let bchLockRes = await userBchService.lockBCH(
        relayerBchAddress, // recipient is Relayer
        hashHex,
        sellAmountBch,
        bchTimelock
    );
    console.log(chalk.green(`    ✅ BCH Locked! Contract: ${bchLockRes.contractAddress}`));

    // 1.3 Relayer Locks MOVE
    let movTimelock = config.timelocks.movement;
    let buyAmountMov = 5000000n; // 0.05 MOVE
    let movHashlockBuf = Buffer.from(hashHex, 'hex');
    console.log(`[3] Relayer locking ${buyAmountMov} MOVE octas on Movement for User...`);
    let movLockRes = await relayerMovService.createEscrow(
        movHashlockBuf,
        userMovAddress, // recipient is User
        buyAmountMov,
        movTimelock,
        TOKENS.movement.MOVE
    );
    console.log(chalk.green(`    ✅ MOVE Locked! Escrow ID: ${movLockRes.escrowId}`));

    // 1.4 User Claims MOVE
    console.log(`[4] User claiming MOVE using Secret...`);
    let movClaimTx = await userMovService.claim(
        movLockRes.escrowId,
        secret,
        TOKENS.movement.MOVE
    );
    console.log(chalk.green(`    ✅ MOVE Claimed! Tx: ${movClaimTx}`));

    // 1.5 Relayer Claims BCH
    console.log(`[5] Relayer claiming BCH using revealed Secret...`);
    let bchClaimTx = await relayerBchService.claimHTLC(
        userBchAddress, // maker is User
        hashHex,
        secretHex,
        bchTimelock
    );
    console.log(chalk.green(`    ✅ BCH Claimed! Tx: ${bchClaimTx}\n`));
    console.log(chalk.yellow(`🎉 FLOW 1 (BCH -> MOVEMENT) SUCCESSFUL!\n`));

    // =====================================================================
    // FLOW 2: MOVEMENT -> BCH
    // =====================================================================
    console.log(chalk.magenta('==========================================================='));
    console.log(chalk.magenta('  FLOW 2: MOVEMENT -> BCH'));
    console.log(chalk.magenta('==========================================================='));

    // Check User MOVE Balance
    const moveBal = await userMovService.getBalances();
    const hasMove = moveBal.find(b => b.symbol === 'MOVE');
    console.log(`User MOVE Balance: ${hasMove?.balance || 0} MOVE`);
    if (!hasMove || hasMove.balance < 0.05) {
        console.error(chalk.red(`❌ User needs at least 0.05 MOVE to test MOV -> BCH.`));
        return;
    }

    // Check Relayer BCH Balance
    let relayerBchBal = await (relayerBchService as any).wallet.getBalance('sat');
    console.log(`Relayer BCH Balance: ${relayerBchBal} sats`);
    if (relayerBchBal < 10000) {
        console.error(chalk.red(`❌ Relayer needs at least 10000 sats to test MOV -> BCH.`));
        return;
    }

    // 2.1 Generate Secret
    secret = randomBytes(32);
    secretHex = secret.toString('hex');
    hashlock = MovementService.generateHashlock(secret);
    hashHex = Buffer.from(hashlock).toString('hex');
    console.log(`[1] Secret Generated: ${secretHex}, Hash: ${hashHex}`);

    // 2.2 User Locks MOVE
    let movTimelock2 = config.timelocks.movement;
    let sellAmountMov = 5000000n; // 0.05 MOVE
    console.log(`[2] User locking ${sellAmountMov} MOVE octas on Movement for Relayer...`);
    let movLockRes2 = await userMovService.createEscrow(
        hashlock,
        relayerMovAddress, // recipient is Relayer
        sellAmountMov,
        movTimelock2,
        TOKENS.movement.MOVE
    );
    console.log(chalk.green(`    ✅ MOVE Locked! Escrow ID: ${movLockRes2.escrowId}`));

    // 2.3 Relayer Locks BCH
    let bchTimelock2 = BigInt(Math.floor(Date.now() / 1000) + config.timelocks.source);
    let buyAmountBch = 5000n;
    console.log(`[3] Relayer locking ${buyAmountBch} sats on BCH for User...`);
    let bchLockRes2 = await relayerBchService.lockBCH(
        userBchAddress, // recipient is User
        hashHex,
        buyAmountBch,
        bchTimelock2
    );
    console.log(chalk.green(`    ✅ BCH Locked! Contract: ${bchLockRes2.contractAddress}`));

    // 2.4 User Claims BCH
    console.log(`[4] User claiming BCH using Secret...`);
    let bchClaimTx2 = await userBchService.claimHTLC(
        relayerBchAddress, // maker is Relayer
        hashHex,
        secretHex,
        bchTimelock2
    );
    console.log(chalk.green(`    ✅ BCH Claimed! Tx: ${bchClaimTx2}`));

    // 2.5 Relayer Claims MOVE
    console.log(`[5] Relayer claiming MOVE using revealed Secret...`);
    let movClaimTx2 = await relayerMovService.claim(
        movLockRes2.escrowId,
        secret,
        TOKENS.movement.MOVE
    );
    console.log(chalk.green(`    ✅ MOVE Claimed! Tx: ${movClaimTx2}\n`));
    console.log(chalk.yellow(`🎉 FLOW 2 (MOVEMENT -> BCH) SUCCESSFUL!\n`));

}

main().catch(console.error);
