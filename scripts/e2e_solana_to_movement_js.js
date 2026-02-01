
const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getAssociatedTokenAddress, NATIVE_MINT } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { createHash, randomBytes } = require('crypto');
require('dotenv').config();

const RELAYER_URL = 'http://localhost:3003';
const MOVEMENT_RECIPIENT = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'; // Mock Movement Address
const IDL_PATH = path.resolve(__dirname, '../src/intent_swap.json');
const idl = require(IDL_PATH);

async function main() {
    console.log("🚀 Starting Solana -> Movement E2E Test (JS)...");

    if (!process.env.SOLANA_PRIVATE_KEY) {
        throw new Error("Missing SOLANA_PRIVATE_KEY in .env");
    }

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
        Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY))
    );
    console.log(`Relayer (Taker): ${relayerKeypair.publicKey.toBase58()}`);

    // 2. Setup Connection & Provider
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    console.log(`RPC URL: ${rpcUrl}`);
    const connection = new Connection(rpcUrl, 'confirmed');
    const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: 'confirmed' });
    const program = new anchor.Program(idl, provider);

    console.log(`User: ${userKeypair.publicKey.toBase58()}`);

    // 3. Generate Secret & Hashlock
    const secret = randomBytes(32);
    const hashlock = createHash('sha256').update(secret).digest();
    const hashlockArr = Array.from(hashlock);
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const amount = new anchor.BN(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL (Reduced amount for test)

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
    console.log(`Maker WSOL (derived): ${makerTokenAccount.toBase58()}`);

    // Verify Connectivity
    console.log("⚡ Fetching Blockhash...");
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    console.log(`Blockhash: ${blockhash}`);

    // Check if ATA exists and fund it (Wrap SOL)
    const { createAssociatedTokenAccountInstruction, createSyncNativeInstruction } = require('@solana/spl-token');

    console.log("⚡ Checking/Wrapping SOL...");
    const preInstructions = [];

    // Check if account exists
    const accountInfo = await connection.getAccountInfo(makerTokenAccount);
    if (!accountInfo) {
        console.log("   Creating WSOL ATA...");
        preInstructions.push(
            createAssociatedTokenAccountInstruction(
                userKeypair.publicKey, // Payer
                makerTokenAccount,
                userKeypair.publicKey, // Owner
                NATIVE_MINT
            )
        );
    }

    // Transfer SOL to ATA
    console.log(`   Transferring ${amount.toString()} lamports to WSOL ATA...`);
    preInstructions.push(
        SystemProgram.transfer({
            fromPubkey: userKeypair.publicKey,
            toPubkey: makerTokenAccount,
            lamports: amount.toNumber(),
        })
    );

    // Sync Native
    preInstructions.push(createSyncNativeInstruction(makerTokenAccount));

    if (preInstructions.length > 0) {
        console.log("⚡ Executing Wrap SOL Transaction...");
        try {
            const wrapTx = new anchor.web3.Transaction().add(...preInstructions);
            wrapTx.recentBlockhash = blockhash;
            wrapTx.feePayer = userKeypair.publicKey;
            wrapTx.sign(userKeypair);

            // Send raw to avoid hang
            const sig = await connection.sendRawTransaction(wrapTx.serialize(), { skipPreflight: true });
            console.log(`✅ Wrap SOL Tx Sent: ${sig}`);

            console.log("⏳ Waiting 5s for confirmation...");
            await new Promise(r => setTimeout(r, 5000));
        } catch (e) {
            console.error("❌ Wrap SOL Failed:", e);
            return;
        }
    }

    // 5. Call 'initialize' on Solana
    try {
        console.log("⚡ Initializing Escrow on Solana...");
        const initTx = await program.methods
            .initialize(hashlockArr, new anchor.BN(timelock), amount)
            .accounts({
                maker: userKeypair.publicKey,
                taker: relayerKeypair.publicKey,
                tokenMint: NATIVE_MINT,
                escrow: escrowPda,
                vault: vaultPda,
                makerTokenAccount: makerTokenAccount,
                systemProgram: SystemProgram.programId,
                tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY
            })
            .transaction();

        initTx.recentBlockhash = blockhash;
        initTx.feePayer = userKeypair.publicKey;
        initTx.sign(userKeypair);

        const tx = await connection.sendRawTransaction(initTx.serialize(), { skipPreflight: true });

        console.log(`✅ Solana Initialize Tx Sent: ${tx}`);
        console.log("⏳ Waiting 10s for confirmation...");
        await new Promise(r => setTimeout(r, 10000));

    } catch (e) {
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
    } catch (e) {
        console.error("❌ Relayer Request Failed:", e.response ? e.response.data : e.message);
    }
}

main()
    .then(() => console.log("Script execution completed."))
    .catch((err) => {
        console.error("Script execution failed:", err);
        process.exit(1);
    });
