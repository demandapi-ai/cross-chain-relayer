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
const web3_js_1 = require("@solana/web3.js");
const path = __importStar(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load .env manually to ensure we get the right one
const envPath = path.resolve(__dirname, '../.env');
dotenv_1.default.config({ path: envPath });
async function main() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new web3_js_1.Connection(rpcUrl, 'confirmed');
    const privateKeyString = process.env.SOLANA_PRIVATE_KEY;
    if (!privateKeyString) {
        throw new Error("SOLANA_PRIVATE_KEY not found in .env");
    }
    let secretKey;
    try {
        secretKey = Uint8Array.from(JSON.parse(privateKeyString));
    }
    catch (e) {
        // Fallback for bs58 if needed (though we checked it's array)
        throw new Error("Invalid private key format. Expected JSON array.");
    }
    const keypair = web3_js_1.Keypair.fromSecretKey(secretKey);
    const address = keypair.publicKey.toBase58();
    console.log("\n==================================================");
    console.log("🔑 Relayer Address:", address);
    console.log("==================================================\n");
    const initialBalance = await connection.getBalance(keypair.publicKey);
    console.log(`💰 Initial Balance: ${(initialBalance / web3_js_1.LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log("🚰 Requesting 5 SOL Airdrop (in chunks)...");
    try {
        // Request 1: 2 SOL
        console.log("   Requesting 2 SOL...");
        const sig1 = await connection.requestAirdrop(keypair.publicKey, 2 * web3_js_1.LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig1);
        console.log("   ✅ Received 2 SOL");
        // Request 2: 2 SOL
        console.log("   Requesting 2 SOL...");
        const sig2 = await connection.requestAirdrop(keypair.publicKey, 2 * web3_js_1.LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig2);
        console.log("   ✅ Received 2 SOL");
        // Request 3: 1 SOL
        console.log("   Requesting 1 SOL...");
        const sig3 = await connection.requestAirdrop(keypair.publicKey, 1 * web3_js_1.LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig3);
        console.log("   ✅ Received 1 SOL");
    }
    catch (error) {
        console.error("❌ Airdrop failed (Rate limit?):", error.message);
    }
    const finalBalance = await connection.getBalance(keypair.publicKey);
    console.log(`\n💰 Final Balance: ${(finalBalance / web3_js_1.LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log("\n✅ Done!");
}
main().catch(console.error);
