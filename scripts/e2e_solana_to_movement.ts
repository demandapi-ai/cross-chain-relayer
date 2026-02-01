
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, NATIVE_MINT } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { createHash, randomBytes } from 'crypto';
import idl from '../src/intent_swap.json';

require('dotenv').config();

const RELAYER_URL = 'http://localhost:3003';
const MOVEMENT_RECIPIENT = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'; // Mock Movement Address

async function main() {
    console.log("🚀 Starting Solana -> Movement E2E Test...");

    // 1. Setup User Wallet
    const userWalletPath = path.resolve(__dirname, '../../test-wallets/user-solana.json');
    if (!fs.existsSync(userWalletPath)) {
        throw new Error("User wallet not found. Run fund_user.ts first.");
    }
    const userKeypair = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(fs.readFileSync(userWalletPath, 'utf-8')))
    );
    const wallet = new anchor.Wallet(userKeypair);

    // Load Relayer Public Key (Taker)
    const relayerKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY || '[]'))
    );
    console.log(`Relayer (Taker): ${relayerKeypair.publicKey.toBase58()}`);

    // 2. Setup Connection & Provider
    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
    const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: 'confirmed' });
    const program = new anchor.Program(idl as any, provider);

    console.log(`User: ${userKeypair.publicKey.toBase58()}`);

    // 3. Generate Secret & Hashlock
    const secret = randomBytes(32);
    const hashlock = createHash('sha256').update(secret).digest();
    const hashlockArr = Array.from(hashlock);
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL

    console.log(`Secret: 0x${secret.toString('hex')}`);
    console.log(`Hashlock: 0x${hashlock.toString('hex')}`);

    // 4. Derive Escrow PDA
    const [escrowPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("escrow"),
            userKeypair.publicKey.toBuffer(),
            hashlock,
        ],
        program.programId
    );

    // vault PDA
    const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), escrowPda.toBuffer()],
        program.programId
    );

    console.log(`Escrow PDA: ${escrowPda.toBase58()}`);

    // Derive WSOL ATA
    const makerTokenAccount = await getAssociatedTokenAddress(NATIVE_MINT, userKeypair.publicKey);
    console.log(`Maker WSOL: ${makerTokenAccount.toBase58()}`);

    // 5. Call 'initialize' on Solana
    try {
        console.log("⚡ Initializing Escrow on Solana...");
        // @ts-ignore
        const tx = await program.methods
            .initialize(hashlockArr, new anchor.BN(timelock), amount)
            .accounts({
                maker: userKeypair.publicKey,
                taker: relayerKeypair.publicKey, // Relayer must be the taker to claim!
                tokenMint: NATIVE_MINT,
                escrow: escrowPda,
                vault: vaultPda,
                makerTokenAccount: makerTokenAccount, // Must be WSOL ATA
                systemProgram: SystemProgram.programId,
                tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY
            })
            .rpc();

        console.log(`✅ Solana Initialize Tx: ${tx}`);
    } catch (e: any) {
        console.error("❌ Solana Initialize Failed:", e);
        return;
    }

    // 6. Call Relayer
    console.log("⚡ Triggering Relayer...");
    try {
        const res = await axios.post(`${RELAYER_URL}/swap/solana-to-movement`, {
            makerAddress: userKeypair.publicKey.toBase58(),
            recipientAddress: MOVEMENT_RECIPIENT,
            sellAmount: amount.toString(),
            buyAmount: (1 * 100000000).toString(), // 1 MOVE (octas)
            hashlock: `0x${hashlock.toString('hex')}`,
            sourceEscrowPda: escrowPda.toBase58()
        });

        console.log("✅ Relayer Response:", res.data);
    } catch (e: any) {
        console.error("❌ Relayer Request Failed:", e.response ? e.response.data : e.message);
    }
}

main()
    .then(() => console.log("Script execution completed."))
    .catch((err) => {
        console.error("Script execution failed:", err);
        process.exit(1);
    });
