"use strict";
/**
 * Fund Relayer WSOL Account
 *
 * This script wraps native SOL into WSOL for the relayer's token account.
 * The relayer needs WSOL to fulfill MOV→SOL swaps.
 *
 * Usage: npx ts-node scripts/fund_relayer_wsol.ts
 */
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
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const dotenv = __importStar(require("dotenv"));
const chalk_1 = __importDefault(require("chalk"));
dotenv.config();
const WRAP_AMOUNT_SOL = 2.0; // Amount of SOL to wrap into WSOL
async function main() {
    console.log(chalk_1.default.cyan('🔄 Fund Relayer WSOL Script'));
    console.log(chalk_1.default.gray('─'.repeat(50)));
    // Load relayer keypair from env
    const privateKeyRaw = process.env.SOLANA_PRIVATE_KEY;
    if (!privateKeyRaw) {
        throw new Error('Missing SOLANA_PRIVATE_KEY in .env');
    }
    const relayerKeypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privateKeyRaw)));
    console.log(chalk_1.default.blue(`📍 Relayer Address: ${relayerKeypair.publicKey.toBase58()}`));
    // Connect to Solana
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new web3_js_1.Connection(rpcUrl, 'confirmed');
    // Get native SOL balance
    const solBalance = await connection.getBalance(relayerKeypair.publicKey);
    console.log(chalk_1.default.blue(`💰 Native SOL Balance: ${(solBalance / web3_js_1.LAMPORTS_PER_SOL).toFixed(4)} SOL`));
    if (solBalance < WRAP_AMOUNT_SOL * web3_js_1.LAMPORTS_PER_SOL + 0.01 * web3_js_1.LAMPORTS_PER_SOL) {
        throw new Error(`Insufficient SOL. Need at least ${WRAP_AMOUNT_SOL + 0.01} SOL`);
    }
    // Get WSOL ATA address
    const wsolAta = await (0, spl_token_1.getAssociatedTokenAddress)(spl_token_1.NATIVE_MINT, relayerKeypair.publicKey);
    console.log(chalk_1.default.blue(`🪙  WSOL ATA: ${wsolAta.toBase58()}`));
    // Check if ATA exists
    let ataExists = false;
    try {
        const accountInfo = await (0, spl_token_1.getAccount)(connection, wsolAta);
        ataExists = true;
        console.log(chalk_1.default.yellow(`📊 Current WSOL Balance: ${Number(accountInfo.amount) / web3_js_1.LAMPORTS_PER_SOL} WSOL`));
    }
    catch (e) {
        console.log(chalk_1.default.yellow('📊 WSOL ATA does not exist, will create it'));
    }
    // Build transaction
    const tx = new web3_js_1.Transaction();
    // Create ATA if it doesn't exist
    if (!ataExists) {
        tx.add((0, spl_token_1.createAssociatedTokenAccountInstruction)(relayerKeypair.publicKey, // payer
        wsolAta, // ata
        relayerKeypair.publicKey, // owner
        spl_token_1.NATIVE_MINT // mint
        ));
    }
    // Transfer SOL to WSOL account
    const wrapAmountLamports = WRAP_AMOUNT_SOL * web3_js_1.LAMPORTS_PER_SOL;
    tx.add(web3_js_1.SystemProgram.transfer({
        fromPubkey: relayerKeypair.publicKey,
        toPubkey: wsolAta,
        lamports: wrapAmountLamports
    }));
    // Sync native instruction to update token balance
    tx.add((0, spl_token_1.createSyncNativeInstruction)(wsolAta));
    console.log(chalk_1.default.cyan(`\n⏳ Wrapping ${WRAP_AMOUNT_SOL} SOL into WSOL...`));
    // Send transaction
    const signature = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [relayerKeypair]);
    console.log(chalk_1.default.green(`✅ Transaction confirmed: ${signature}`));
    // Verify new balance
    const newAccount = await (0, spl_token_1.getAccount)(connection, wsolAta);
    console.log(chalk_1.default.green(`🪙  New WSOL Balance: ${Number(newAccount.amount) / web3_js_1.LAMPORTS_PER_SOL} WSOL`));
    console.log(chalk_1.default.gray('─'.repeat(50)));
    console.log(chalk_1.default.green('🎉 Relayer WSOL funded successfully!'));
}
main().catch(console.error);
