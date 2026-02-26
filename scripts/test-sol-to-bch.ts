
import { BCHService } from '../src/services/BCHService';
import { SolanaService } from '../src/services/SolanaService';
import { BCHSolanaRelayerCore } from '../src/services/BCHSolanaRelayerCore';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import chalk from 'chalk';
import * as fs from 'fs';
import { randomBytes, createHash } from 'crypto';
import { config } from '../src/config';

// Ensure .env is loaded
import dotenv from 'dotenv';
dotenv.config();

// Fix BN
const BN = (anchor as any).BN || (anchor as any).default?.BN;

// Override Poll Interval for Speed
process.env.POLL_INTERVAL_MS = '2000';
process.env.PORT = '3006';
try { (config as any).pollIntervalMs = 2000; } catch { }

async function main() {
    console.log(chalk.magenta('🚀 Starting Integration Test: SOL (User) -> BCH (User) [Embedded Relayer]'));

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

    // 2. Init Services
    const userBchService = new BCHService();
    await userBchService.initWallet(userKeys.bchWif);

    const userSolKey = JSON.stringify(userKeys.solSecret);
    const userSolService = new SolanaService(userSolKey);

    // Check Balances
    const solConn = new Connection(config.solana.rpcUrl);
    const solBal = await solConn.getBalance(userSolService.publicKey);
    console.log(`   User SOL: ${solBal / LAMPORTS_PER_SOL} SOL`);
    if (solBal < 0.02 * LAMPORTS_PER_SOL) {
        console.error(chalk.red(`❌ User SOL Balance too low (Need ~0.02 for lock + rent)`));
        process.exit(1);
    }

    // 3. Generate Secret
    const secret = randomBytes(32);
    const secretHex = secret.toString('hex');
    const hash = createHash('sha256').update(secret).digest();
    const hashHex = hash.toString('hex');
    console.log(chalk.cyan(`   Generated Secret: ${secretHex}`));

    // 4. Lock SOL (User Action)
    const amountLamports = new BN(10000000); // 0.01 SOL
    const timelock = new BN(Math.floor(Date.now() / 1000) + 3600);

    // Relayer is Recipient on Solana
    const relayerSolPubkey = (relayer as any).solanaService.publicKey;

    console.log(chalk.yellow(`\n   User locking 0.01 SOL...`));
    let escrowPdaString: string;
    try {
        const { tx, escrowPda } = await userSolService.createEscrow(
            relayerSolPubkey, // Recipient matches Relayer
            hash,
            amountLamports,
            timelock
        );
        console.log(chalk.green(`   ✅ SOL Locked! PDA: ${escrowPda}`));
        escrowPdaString = escrowPda;
    } catch (e: any) {
        console.error(chalk.red('❌ Failed to lock SOL:'), e.message);
        process.exit(1);
    }

    // 5. Submit to Relayer
    console.log(chalk.yellow('\n   Submitting to Relayer Core...'));
    const payload = {
        makerAddress: userSolService.publicKey.toBase58(),
        recipientAddress: userBchService.wallet!.cashaddr!,
        sellAmount: amountLamports.toString(),
        buyAmount: "50000", // 50k sats
        hashlock: `0x${hashHex}`,
        solanaEscrowPda: escrowPdaString!
    };

    const intent = await relayer.handleSolanaToBCH(payload);
    console.log(chalk.green(`   ✅ Relayer Accepted Intent: ${intent.id}`));

    // 6. Poll Relayer for BCH HTLC
    console.log(chalk.yellow('\n   Waiting for Relayer to lock BCH...'));

    let bchContractAddress: string | undefined;

    for (let i = 0; i < 40; i++) {
        const updatedIntent = relayer.getIntent(intent.id);
        if (updatedIntent && updatedIntent.status === 'DEST_FILLED') { // or later status
            console.log(chalk.green(`\n   ✅ Relayer Locked BCH!`));
            bchContractAddress = updatedIntent.bchContractAddress;
            break;
        }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 2000));
    }

    if (!bchContractAddress) {
        console.error(chalk.red('\n❌ Timeout waiting for Relayer to lock BCH.'));
        process.exit(1);
    }

    // 7. Claim BCH (User Action)
    console.log(chalk.yellow(`\n   Attempting to Claim BCH from Relayer...`));
    console.log('   (Waiting 10s for UTXO propagation...)');
    await new Promise(r => setTimeout(r, 10000));

    try {
        // We know the secret!

        // We need the ACTUAL timelock used by Relayer.
        const finalIntent = relayer.getIntent(intent.id);
        const relayerTimelock = BigInt(finalIntent!.destTimelock);

        // Also we need Relayer's address (Maker).
        const relayerBchAddr = (relayer as any).bchService.wallet.cashaddr;

        const txIdClaim = await userBchService.claimHTLC(
            relayerBchAddr,
            hashHex,
            secretHex,
            relayerTimelock
        );

        console.log(chalk.green(`   ✅ Claimed BCH! Tx: ${txIdClaim}`));
        console.log(chalk.green(`   🎉 E2E Test Passed (SOL -> BCH)`));
        process.exit(0);

    } catch (e: any) {
        console.error(chalk.red('❌ Claim Failed:'), e.message);
        process.exit(1);
    }
}

main();
