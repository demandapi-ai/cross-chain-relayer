import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { MovementService } from '../src/services/MovementService';
import { BCHService } from '../src/services/BCHService';
import { SolanaService } from '../src/services/SolanaService';
import * as fs from 'fs';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { randomBytes, createHash } from 'crypto';
import { config, TOKENS } from '../src/config';

dotenv.config();

type TestResult = { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; error?: string; txs?: string[] };
const results: TestResult[] = [];

// Devnet USDC Mint
const USDC_MINT = new PublicKey(TOKENS.solana.USDC);
// Amount for testing: 0.1 USDC (USDC has 6 decimals, so 100000 base units)
const USDC_AMOUNT = new BN(100_000);

async function main() {
    console.log(chalk.blue('╔══════════════════════════════════════════════════════════╗'));
    console.log(chalk.blue('║     SOLANA USDC CROSS-CHAIN SWAP TEST SUITE              ║'));
    console.log(chalk.blue('╚══════════════════════════════════════════════════════════╝\n'));

    // 1. Load keys
    const userKeys = JSON.parse(fs.readFileSync('user_keys.json', 'utf-8'));

    // 2. Init User BCH
    const userBchService = new BCHService();
    await userBchService.initWallet(userKeys.bchWif);

    // 3. Init User Movement
    const originalMovKey = process.env.MOVEMENT_PRIVATE_KEY;
    process.env.MOVEMENT_PRIVATE_KEY = userKeys.movSecret;
    const userMovService = new MovementService();

    // 4. Init User Solana
    const userSolKeypair = Keypair.fromSecretKey(Uint8Array.from(userKeys.solSecret));
    const userSolService = new SolanaService(JSON.stringify(Array.from(userKeys.solSecret)));

    // 5. Init Relayer services
    process.env.MOVEMENT_PRIVATE_KEY = originalMovKey;
    const relayerBchService = new BCHService();
    await relayerBchService.initWallet(process.env.BCH_PRIVATE_KEY_WIF);
    const relayerMovService = new MovementService();
    const relayerSolService = new SolanaService();

    // Print actors
    const userBch = userBchService.wallet!.cashaddr!;
    const relayerBch = relayerBchService.wallet!.cashaddr!;
    const userMov = userMovService.account.accountAddress.toString();
    const relayerMov = relayerMovService.account.accountAddress.toString();
    const userSol = userSolKeypair.publicKey.toBase58();
    const relayerSol = relayerSolService.publicKey.toBase58();

    console.log(chalk.gray('Actors:'));
    console.log(chalk.gray(`  User BCH:     ${userBch}`));
    console.log(chalk.gray(`  User MOV:     ${userMov}`));
    console.log(chalk.gray(`  User SOL:     ${userSol}`));
    console.log(chalk.gray(`  Relayer BCH:  ${relayerBch}`));
    console.log(chalk.gray(`  Relayer MOV:  ${relayerMov}`));
    console.log(chalk.gray(`  Relayer SOL:  ${relayerSol}\n`));

    // ===== FLOW 1: BCH -> Solana (USDC) =====
    await testFlow('BCH → Solana (USDC)', async () => {
        const secret = randomBytes(32);
        const hashBuf = Buffer.from(createHash('sha256').update(secret).digest());
        const hashHex = hashBuf.toString('hex');
        const timelock = BigInt(Math.floor(Date.now() / 1000) + config.timelocks.source);
        const txs: string[] = [];

        // User locks BCH
        const bchLock = await userBchService.lockBCH(relayerBch, hashHex, 3000n, timelock);
        txs.push(`BCH Lock: ${bchLock.txId}`);

        // Relayer locks USDC
        const solLock = await relayerSolService.createEscrow(
            userSolKeypair.publicKey,
            hashBuf,
            USDC_AMOUNT,
            new BN(config.timelocks.dest),
            USDC_MINT
        );
        txs.push(`SOL (USDC) Lock: ${solLock.tx}`);

        // User claims USDC
        const solClaim = await userSolService.claimEscrow(
            relayerSolService.publicKey, // maker
            hashBuf,
            secret,
            new PublicKey(solLock.escrowPda),
            USDC_MINT
        );
        txs.push(`SOL (USDC) Claim: ${solClaim}`);

        // Relayer claims BCH
        const bchClaim = await relayerBchService.claimHTLC(userBch, hashHex, secret.toString('hex'), timelock);
        txs.push(`BCH Claim: ${bchClaim}`);

        return txs;
    });

    // ===== FLOW 2: Solana (USDC) -> BCH =====
    await testFlow('Solana (USDC) → BCH', async () => {
        const secret = randomBytes(32);
        const hashBuf = Buffer.from(createHash('sha256').update(secret).digest());
        const hashHex = hashBuf.toString('hex');
        const timelock = BigInt(Math.floor(Date.now() / 1000) + config.timelocks.source);
        const txs: string[] = [];

        // User locks USDC
        const solLock = await userSolService.createEscrow(
            relayerSolService.publicKey,
            hashBuf,
            USDC_AMOUNT,
            new BN(config.timelocks.source),
            USDC_MINT
        );
        txs.push(`SOL (USDC) Lock: ${solLock.tx}`);

        // Relayer locks BCH
        const bchLock = await relayerBchService.lockBCH(userBch, hashHex, 3000n, timelock);
        txs.push(`BCH Lock: ${bchLock.txId}`);

        // User claims BCH
        const bchClaim = await userBchService.claimHTLC(relayerBch, hashHex, secret.toString('hex'), timelock);
        txs.push(`BCH Claim: ${bchClaim}`);

        // Relayer claims USDC
        const solClaim = await relayerSolService.claimEscrow(
            userSolKeypair.publicKey,
            hashBuf,
            secret,
            new PublicKey(solLock.escrowPda),
            USDC_MINT
        );
        txs.push(`SOL (USDC) Claim: ${solClaim}`);

        return txs;
    });

    // ===== FLOW 3: Solana (USDC) -> Movement (MOVE) =====
    await testFlow('Solana (USDC) → Movement (MOVE)', async () => {
        const secret = randomBytes(32);
        const hashBuf = Buffer.from(createHash('sha256').update(secret).digest());
        const hashlock = MovementService.generateHashlock(secret);
        const txs: string[] = [];

        // User locks USDC
        const solLock = await userSolService.createEscrow(
            relayerSolService.publicKey,
            hashBuf,
            USDC_AMOUNT,
            new BN(config.timelocks.source),
            USDC_MINT
        );
        txs.push(`SOL (USDC) Lock: ${solLock.tx}`);

        // Relayer locks MOVE
        const movLock = await relayerMovService.createEscrow(
            Buffer.from(hashBuf), userMov, 1000000n, config.timelocks.movement, TOKENS.movement.MOVE
        );
        txs.push(`MOV Lock: ${movLock.txHash}`);

        // User claims MOVE
        const movClaim = await userMovService.claim(movLock.escrowId, secret, TOKENS.movement.MOVE);
        txs.push(`MOV Claim: ${movClaim}`);

        // Relayer claims USDC
        const solClaim = await relayerSolService.claimEscrow(
            userSolKeypair.publicKey,
            hashBuf,
            secret,
            new PublicKey(solLock.escrowPda),
            USDC_MINT
        );
        txs.push(`SOL (USDC) Claim: ${solClaim}`);

        return txs;
    });

    // ===== FLOW 4: Movement (MOVE) -> Solana (USDC) =====
    await testFlow('Movement (MOVE) → Solana (USDC)', async () => {
        const secret = randomBytes(32);
        const hashBuf = Buffer.from(createHash('sha256').update(secret).digest());
        const hashlock = MovementService.generateHashlock(secret);
        const txs: string[] = [];

        // User locks MOVE
        const movLock = await userMovService.createEscrow(
            hashlock, relayerMov, 1000000n, config.timelocks.movement, TOKENS.movement.MOVE
        );
        txs.push(`MOV Lock: ${movLock.txHash}`);

        // Relayer locks USDC
        const solLock = await relayerSolService.createEscrow(
            userSolKeypair.publicKey,
            hashBuf,
            USDC_AMOUNT,
            new BN(config.timelocks.dest),
            USDC_MINT
        );
        txs.push(`SOL (USDC) Lock: ${solLock.tx}`);

        // User claims USDC
        const solClaim = await userSolService.claimEscrow(
            relayerSolService.publicKey,
            hashBuf,
            secret,
            new PublicKey(solLock.escrowPda),
            USDC_MINT
        );
        txs.push(`SOL (USDC) Claim: ${solClaim}`);

        // Relayer claims MOVE
        const movClaim = await relayerMovService.claim(movLock.escrowId, secret, TOKENS.movement.MOVE);
        txs.push(`MOV Claim: ${movClaim}`);

        return txs;
    });

    // ===== RESULTS =====
    console.log(chalk.blue('\n╔══════════════════════════════════════════════════════════╗'));
    console.log(chalk.blue('║                    FINAL RESULTS                        ║'));
    console.log(chalk.blue('╚══════════════════════════════════════════════════════════╝\n'));

    for (const r of results) {
        const icon = r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️' : '❌';
        const color = r.status === 'PASS' ? chalk.green : r.status === 'SKIP' ? chalk.yellow : chalk.red;
        console.log(color(`${icon} ${r.name}: ${r.status}`));
        if (r.error) console.log(chalk.red(`   Error: ${r.error}`));
        if (r.txs) r.txs.forEach(tx => console.log(chalk.gray(`   ${tx}`)));
    }

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const skipped = results.filter(r => r.status === 'SKIP').length;
    console.log(chalk.blue(`\nTotal: ${passed} passed, ${failed} failed, ${skipped} skipped out of ${results.length}`));
}

async function testFlow(name: string, fn: () => Promise<string[]>) {
    console.log(chalk.magenta(`\n${'='.repeat(60)}`));
    console.log(chalk.magenta(`  ${name}`));
    console.log(chalk.magenta(`${'='.repeat(60)}`));

    try {
        const txs = await fn();
        results.push({ name, status: 'PASS', txs });
        console.log(chalk.green(`\n🎉 ${name} — PASSED\n`));
    } catch (e: any) {
        if (e.message?.includes('too low')) {
            results.push({ name, status: 'SKIP', error: e.message });
            console.log(chalk.yellow(`\n⏭️ ${name} — SKIPPED: ${e.message}\n`));
        } else {
            results.push({ name, status: 'FAIL', error: e.message });
            console.log(chalk.red(`\n❌ ${name} — FAILED: ${e.message}\n`));
        }
    }
}

main().catch(console.error);
