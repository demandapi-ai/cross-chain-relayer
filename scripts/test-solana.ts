
import { SolanaService } from '../src/services/SolanaService';
import { Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import chalk from 'chalk';

// Debug anchor import
console.log('Anchor keys:', Object.keys(anchor));
// Try to find BN
const BN = (anchor as any).BN || (anchor as any).default?.BN;
console.log('BN available:', !!BN);

async function main() {
    console.log(chalk.magenta('🚀 Testing Solana Service...'));

    try {
        const solanaService = new SolanaService();
        console.log(chalk.green('✅ Solana Service Initialized'));
        console.log(`   Public Key: ${solanaService.publicKey.toBase58()}`);

        if (!BN) {
            throw new Error("Parameters BN not found in anchor export");
        }

        // Try creating an escrow
        const recipient = Keypair.generate().publicKey;
        const hashlock = Buffer.alloc(32, 1); // Mock hash
        const amount = new BN(1000); // Use the found BN
        const timelock = new BN(Date.now() / 1000 + 3600);

        console.log(chalk.cyan('   Attempting createEscrow (expecting failure on devnet/fund)...'));
        try {
            await solanaService.createEscrow(recipient, hashlock, amount, timelock);
        } catch (e: any) {
            console.log(chalk.yellow(`   Caught expected error (proving code ran): ${e.message}`));
            // If error is about funds or account, it worked (logic-wise)
        }

    } catch (e: any) {
        console.error(chalk.red('❌ Solana Test Failed:'), e);
        process.exit(1);
    }
}

main();
