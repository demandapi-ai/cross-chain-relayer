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
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Load env
require('dotenv').config();
async function main() {
    const connection = new web3_js_1.Connection('https://devnet.helius-rpc.com/?api-key=7ceb6609-616a-4e84-ba92-5ee3d04eb5e7', 'confirmed');
    // 1. Load User Wallet (J5V2...)
    const userWalletPath = path.resolve(__dirname, '../../test-wallets/user-solana.json');
    if (!fs.existsSync(userWalletPath)) {
        throw new Error('User wallet not found');
    }
    const userKeypair = web3_js_1.Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(userWalletPath, 'utf-8'))));
    // 2. Load Relayer Wallet (from env)
    const relayerKeypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY || '[]')));
    console.log('User PubKey:', userKeypair.publicKey.toBase58());
    console.log('Relayer PubKey:', relayerKeypair.publicKey.toBase58());
    // Helper to setup WSOL
    const setupWSOL = async (kp, name) => {
        const ata = await (0, spl_token_1.getAssociatedTokenAddress)(spl_token_1.NATIVE_MINT, kp.publicKey);
        console.log(`${name} WSOL ATA: ${ata.toBase58()}`);
        const tx = new web3_js_1.Transaction();
        // Check if ATA exists
        const info = await connection.getAccountInfo(ata);
        if (!info) {
            console.log(`Creating WSOL ATA for ${name}...`);
            tx.add((0, spl_token_1.createAssociatedTokenAccountInstruction)(kp.publicKey, // payer
            ata, kp.publicKey, // owner
            spl_token_1.NATIVE_MINT));
        }
        // Fund with SOL (0.01 SOL) - Transfer to ATA
        console.log(`Funding ${name} WSOL ATA with 0.01 SOL...`);
        tx.add(web3_js_1.SystemProgram.transfer({
            fromPubkey: kp.publicKey,
            toPubkey: ata,
            lamports: 10000000 // 0.01 SOL
        }), (0, spl_token_1.createSyncNativeInstruction)(ata));
        try {
            const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [kp]);
            console.log(`${name} Setup Success: ${sig}`);
        }
        catch (e) {
            console.log(`${name} Setup Error (likely already funded/exists):`, e.message);
        }
        return ata;
    };
    // Setup for both
    await setupWSOL(userKeypair, 'User');
    await setupWSOL(relayerKeypair, 'Relayer');
}
main().then(() => console.log('Done')).catch(console.error);
