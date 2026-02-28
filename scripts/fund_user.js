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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
require('dotenv').config();
async function main() {
    const connection = new web3_js_1.Connection('https://devnet.helius-rpc.com/?api-key=7ceb6609-616a-4e84-ba92-5ee3d04eb5e7', 'confirmed');
    // 1. Relayer Wallet (From .env)
    const relayerKeypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY || '[]')));
    // 2. User Wallet
    const userWalletDir = path.resolve(__dirname, '../../test-wallets');
    if (!fs.existsSync(userWalletDir)) {
        fs.mkdirSync(userWalletDir, { recursive: true });
    }
    const userWalletPath = path.join(userWalletDir, 'user-solana.json');
    let userKeypair;
    if (fs.existsSync(userWalletPath)) {
        userKeypair = web3_js_1.Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(userWalletPath, 'utf-8'))));
    }
    else {
        console.log("Generating new User Wallet...");
        userKeypair = web3_js_1.Keypair.generate();
        fs.writeFileSync(userWalletPath, JSON.stringify(Array.from(userKeypair.secretKey)));
    }
    const userPubkey = userKeypair.publicKey;
    console.log(`Relayer: ${relayerKeypair.publicKey.toBase58()}`);
    console.log(`User: ${userPubkey.toBase58()}`);
    // Check balances
    const relayerBalance = await connection.getBalance(relayerKeypair.publicKey);
    const userBalance = await connection.getBalance(userPubkey);
    console.log(`Relayer Balance: ${relayerBalance / web3_js_1.LAMPORTS_PER_SOL} SOL`);
    console.log(`User Balance: ${userBalance / web3_js_1.LAMPORTS_PER_SOL} SOL`);
    if (relayerBalance < 0.5 * web3_js_1.LAMPORTS_PER_SOL) {
        console.error("Relayer has insufficient funds to fund user.");
        return;
    }
    // Transfer 0.5 SOL
    const amount = 0.5 * web3_js_1.LAMPORTS_PER_SOL;
    console.log(`Transferring ${amount / web3_js_1.LAMPORTS_PER_SOL} SOL to User...`);
    const tx = new web3_js_1.Transaction().add(web3_js_1.SystemProgram.transfer({
        fromPubkey: relayerKeypair.publicKey,
        toPubkey: userPubkey,
        lamports: amount,
    }));
    const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [relayerKeypair]);
    console.log(`Transfer Success: ${sig}`);
}
main().then(() => console.log('Done')).catch(console.error);
