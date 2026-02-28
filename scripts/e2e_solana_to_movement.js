"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const intent_swap_json_1 = __importDefault(require("../src/intent_swap.json"));
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
    const userKeypair = web3_js_1.Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(userWalletPath, 'utf-8'))));
    const wallet = new anchor.Wallet(userKeypair);
    // Load Relayer Public Key (Taker)
    const relayerKeypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY || '[]')));
    console.log(`Relayer (Taker): ${relayerKeypair.publicKey.toBase58()}`);
    // 2. Setup Connection & Provider
    const connection = new web3_js_1.Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
    const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: 'confirmed' });
    const program = new anchor.Program(intent_swap_json_1.default, provider);
    console.log(`User: ${userKeypair.publicKey.toBase58()}`);
    // 3. Generate Secret & Hashlock
    const secret = (0, crypto_1.randomBytes)(32);
    const hashlock = (0, crypto_1.createHash)('sha256').update(secret).digest();
    const hashlockArr = Array.from(hashlock);
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const amount = new anchor.BN(0.1 * web3_js_1.LAMPORTS_PER_SOL); // 0.1 SOL
    console.log(`Secret: 0x${secret.toString('hex')}`);
    console.log(`Hashlock: 0x${hashlock.toString('hex')}`);
    // 4. Derive Escrow PDA
    const [escrowPda] = web3_js_1.PublicKey.findProgramAddressSync([
        Buffer.from("escrow"),
        userKeypair.publicKey.toBuffer(),
        hashlock,
    ], program.programId);
    // vault PDA
    const [vaultPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("vault"), escrowPda.toBuffer()], program.programId);
    console.log(`Escrow PDA: ${escrowPda.toBase58()}`);
    // Derive WSOL ATA
    const makerTokenAccount = await (0, spl_token_1.getAssociatedTokenAddress)(spl_token_1.NATIVE_MINT, userKeypair.publicKey);
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
            tokenMint: spl_token_1.NATIVE_MINT,
            escrow: escrowPda,
            vault: vaultPda,
            makerTokenAccount: makerTokenAccount, // Must be WSOL ATA
            systemProgram: web3_js_1.SystemProgram.programId,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY
        })
            .rpc();
        console.log(`✅ Solana Initialize Tx: ${tx}`);
    }
    catch (e) {
        console.error("❌ Solana Initialize Failed:", e);
        return;
    }
    // 6. Call Relayer
    console.log("⚡ Triggering Relayer...");
    try {
        const res = await axios_1.default.post(`${RELAYER_URL}/swap/solana-to-movement`, {
            makerAddress: userKeypair.publicKey.toBase58(),
            recipientAddress: MOVEMENT_RECIPIENT,
            sellAmount: amount.toString(),
            buyAmount: (1 * 100000000).toString(), // 1 MOVE (octas)
            hashlock: `0x${hashlock.toString('hex')}`,
            sourceEscrowPda: escrowPda.toBase58()
        });
        console.log("✅ Relayer Response:", res.data);
    }
    catch (e) {
        console.error("❌ Relayer Request Failed:", e.response ? e.response.data : e.message);
    }
}
main()
    .then(() => console.log("Script execution completed."))
    .catch((err) => {
    console.error("Script execution failed:", err);
    process.exit(1);
});
