
import * as anchor from '@coral-xyz/anchor';
import { Program, Wallet, AnchorProvider } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createApproveInstruction, createSyncNativeInstruction, NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import idl from '../src/intent_swap.json';
import * as fs from 'fs';
import * as path from 'path';

// Load env
require('dotenv').config();

async function main() {
    const connection = new Connection('https://devnet.helius-rpc.com/?api-key=7ceb6609-616a-4e84-ba92-5ee3d04eb5e7', 'confirmed');

    // 1. Load User Wallet (J5V2...)
    const userWalletPath = path.resolve(__dirname, '../../test-wallets/user-solana.json');
    if (!fs.existsSync(userWalletPath)) {
        throw new Error('User wallet not found');
    }
    const userKeypair = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(fs.readFileSync(userWalletPath, 'utf-8')))
    );

    // 2. Load Relayer Wallet (from env)
    const relayerKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY || '[]'))
    );

    console.log('User PubKey:', userKeypair.publicKey.toBase58());
    console.log('Relayer PubKey:', relayerKeypair.publicKey.toBase58());

    // Helper to setup WSOL
    const setupWSOL = async (kp: Keypair, name: string) => {
        const ata = await getAssociatedTokenAddress(NATIVE_MINT, kp.publicKey);
        console.log(`${name} WSOL ATA: ${ata.toBase58()}`);

        const tx = new Transaction();

        // Check if ATA exists
        const info = await connection.getAccountInfo(ata);
        if (!info) {
            console.log(`Creating WSOL ATA for ${name}...`);
            tx.add(
                createAssociatedTokenAccountInstruction(
                    kp.publicKey, // payer
                    ata,
                    kp.publicKey, // owner
                    NATIVE_MINT
                )
            );
        }

        // Fund with SOL (0.01 SOL) - Transfer to ATA
        console.log(`Funding ${name} WSOL ATA with 0.01 SOL...`);
        tx.add(
            SystemProgram.transfer({
                fromPubkey: kp.publicKey,
                toPubkey: ata,
                lamports: 10000000 // 0.01 SOL
            }),
            createSyncNativeInstruction(ata)
        );

        try {
            const sig = await sendAndConfirmTransaction(connection, tx, [kp]);
            console.log(`${name} Setup Success: ${sig}`);
        } catch (e: any) {
            console.log(`${name} Setup Error (likely already funded/exists):`, e.message);
        }

        return ata;
    };

    // Setup for both
    await setupWSOL(userKeypair, 'User');
    await setupWSOL(relayerKeypair, 'Relayer');
}

main().then(() => console.log('Done')).catch(console.error);
