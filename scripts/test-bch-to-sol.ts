
import { BCHService } from '../src/services/BCHService';
import { SolanaService } from '../src/services/SolanaService';
import { BCHSolanaRelayerCore } from '../src/services/BCHSolanaRelayerCore';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import chalk from 'chalk';
import * as fs from 'fs';
import { randomBytes, createHash } from 'crypto';
import { config } from '../src/config';

// Ensure .env is loaded
import dotenv from 'dotenv';
dotenv.config();

// Override Poll Interval for Speed
process.env.POLL_INTERVAL_MS = '2000';
process.env.PORT = '3005';
// We might need to reload config to pick it up? 
// config.ts reads process.env at load time. Modules are cached.
// But we can just rely on the fact that Relayer loop handles it.
// Actually, since config object is likely already loaded, we can't change it easily unless we modify the property if it's mutable?
// config object in `src/config.ts` is const. But properties might be writable?
// Let's try to write to it if allowed, or just accept 10s wait.
try { (config as any).pollIntervalMs = 2000; } catch { }

async function main() {
    console.log(chalk.blue('🚀 Starting Integration Test: BCH (User) -> SOL (User) [Embedded Relayer]'));

    // 0. Start Relayer Core
    console.log(chalk.magenta('   Starting Relayer Core...'));
    const relayer = new BCHSolanaRelayerCore();

    // 1. Load User Keys
    const userKeyFile = 'user_keys.json';
    if (!fs.existsSync(userKeyFile)) {
        console.error('❌ Run setup-e2e.ts first!');
        process.exit(1);
    }
    const userKeys = JSON.parse(fs.readFileSync(userKeyFile, 'utf-8'));

    // 2. Init Services for User
    console.log(chalk.yellow('   Initializing User Wallets...'));
    const userBchService = new BCHService();
    await userBchService.initWallet(userKeys.bchWif);

    const userSolKey = JSON.stringify(userKeys.solSecret);
    const userSolService = new SolanaService(userSolKey);

    // Check Balances
    const bchBal = await userBchService.wallet!.getBalance('sat');
    console.log(`   User BCH: ${bchBal} sats`);
    if (bchBal < 10000) {
        console.error(chalk.red(`❌ User BCH Balance too low`));
        process.exit(1);
    }
    const solConn = new Connection(config.solana.rpcUrl); // Use config url
    const solBal = await solConn.getBalance(userSolService.publicKey);
    console.log(`   User SOL: ${solBal / LAMPORTS_PER_SOL} SOL`);
    if (solBal < 0.001 * LAMPORTS_PER_SOL) {
        console.error(chalk.red(`❌ User SOL Balance too low`)); // Need gas to claim
        process.exit(1);
    }

    // 3. Generate Secret
    const secret = randomBytes(32);
    const secretHex = secret.toString('hex');
    const hash = createHash('sha256').update(secret).digest();
    const hashHex = hash.toString('hex');
    console.log(chalk.cyan(`   Generated Secret: ${secretHex}`));
    console.log(chalk.cyan(`   Hash: ${hashHex}`));

    // 4. Lock BCH (User Action)
    const amount = 10000n;
    const timelock = BigInt(Math.floor(Date.now() / 1000) + 7200); // 2 hours
    console.log(chalk.yellow(`\n   User locking ${amount} sats on BCH...`));

    const lockResult = await userBchService.lockBCH(
        userBchService.wallet!.cashaddr!,
        hashHex,
        amount,
        timelock
    );
    console.log(chalk.green(`   ✅ BCH Locked! Contract: ${lockResult.contractAddress}`));
    console.log(`   TxID: ${lockResult.txId}`);

    // 5. Submit to Relayer (Direct Call)
    console.log(chalk.yellow('\n   Submitting to Relayer Core...'));
    const payload = {
        makerAddress: userBchService.wallet!.cashaddr!,
        recipientAddress: userSolService.publicKey.toBase58(),
        sellAmount: amount.toString(),
        buyAmount: "1000000", // 0.001 SOL
        hashlock: `0x${hashHex}`,
        bchContractAddress: lockResult.contractAddress
    };

    const intent = await relayer.handleBCHToSolana(payload);
    console.log(chalk.green(`   ✅ Relayer Accepted Intent: ${intent.id}`));

    // 6. Poll for Solana Escrow (Relayer Action)
    console.log(chalk.yellow('\n   Waiting for Relayer to lock SOL...'));

    // Derive Maker (Relayer)
    // We can access private property of Relayer if we really want, but better to use .env
    // Or just import existing Relayer logic?
    // The relayer instance has `solanaService`.
    const relayerPubkey = (relayer as any).solanaService.publicKey;

    const programId = new PublicKey(config.solana.programId);
    const [escrowPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("escrow"),
            relayerPubkey.toBuffer(),
            hash
        ],
        programId
    );
    console.log(`   Escrow PDA: ${escrowPda.toBase58()}`);

    let foundEscrow = false;
    for (let i = 0; i < 40; i++) { // Wait up to 80s (Relayer needs to detect BCH first)
        // Relayer detects BCH by reading contract balance.
        // It polls every X seconds.
        const info = await solConn.getAccountInfo(escrowPda);
        if (info) {
            console.log(chalk.green(`\n   ✅ Escrow found on Solana!`));
            foundEscrow = true;
            break;
        }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 2000));
    }

    if (!foundEscrow) {
        console.error(chalk.red('\n❌ Timeout waiting for Relayer to create Escrow.'));
        process.exit(1);
    }

    // 7. Claim Solana Escrow (User Action)
    console.log(chalk.yellow(`\n   Attempting to Claim SOL from Relayer...`));

    try {
        const tx = await userSolService.claimEscrow(
            relayerPubkey,
            hash,
            secret,
            escrowPda
        );
        console.log(chalk.green(`   ✅ Claimed SOL! Tx: ${tx}`));
        console.log(chalk.green(`   🎉 E2E Test Passed (BCH -> SOL)`));
        process.exit(0);
    } catch (e: any) {
        console.error(chalk.red('❌ Claim Failed:'), e.message);
        process.exit(1);
    }
}

main();
