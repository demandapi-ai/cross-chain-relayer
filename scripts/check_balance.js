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
const spl_token_1 = require("@solana/spl-token");
const ts_sdk_1 = require("@aptos-labs/ts-sdk");
const dotenv = __importStar(require("dotenv"));
const chalk_1 = __importDefault(require("chalk"));
const path = __importStar(require("path"));
// Load .env
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });
async function main() {
    console.log(chalk_1.default.cyan('Running Relayer Balance Check...'));
    console.log(chalk_1.default.gray('─'.repeat(50)));
    // ================= SOLANA =================
    const solPrivateKeyRaw = process.env.SOLANA_PRIVATE_KEY;
    if (!solPrivateKeyRaw)
        throw new Error('Missing SOLANA_PRIVATE_KEY in .env');
    let solSecretKey;
    try {
        solSecretKey = Uint8Array.from(JSON.parse(solPrivateKeyRaw));
    }
    catch {
        throw new Error('Invalid SOLANA_PRIVATE_KEY format in .env');
    }
    const solKeypair = web3_js_1.Keypair.fromSecretKey(solSecretKey);
    const solAddress = solKeypair.publicKey.toBase58();
    console.log(chalk_1.default.cyan('🔑 Solana Relayer:'), chalk_1.default.whiteBright(solAddress));
    const solRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const solConnection = new web3_js_1.Connection(solRpcUrl, 'confirmed');
    // 1. Check Native SOL Balance
    const balanceLamports = await solConnection.getBalance(solKeypair.publicKey);
    const solBalance = balanceLamports / web3_js_1.LAMPORTS_PER_SOL;
    // 2. Check WSOL Balance
    const wsolAta = await (0, spl_token_1.getAssociatedTokenAddress)(spl_token_1.NATIVE_MINT, solKeypair.publicKey);
    let wsolBalance = 0;
    try {
        const accountInfo = await (0, spl_token_1.getAccount)(solConnection, wsolAta);
        wsolBalance = Number(accountInfo.amount) / web3_js_1.LAMPORTS_PER_SOL;
    }
    catch (e) {
        // ATA likely doesn't exist
    }
    console.log(chalk_1.default.green('💰 Native SOL:'), chalk_1.default.bold(`${solBalance.toFixed(4)} SOL`));
    console.log(chalk_1.default.blue('🪙  Wrapped SOL:'), chalk_1.default.bold(`${wsolBalance.toFixed(4)} WSOL`));
    console.log(chalk_1.default.gray('─'.repeat(50)));
    // ================= MOVEMENT =================
    const movPrivateKeyRaw = process.env.MOVEMENT_PRIVATE_KEY;
    if (!movPrivateKeyRaw) {
        console.log(chalk_1.default.yellow('⚠️  MOVEMENT_PRIVATE_KEY not found. Skipping Movement check.'));
    }
    else {
        const movRpcUrl = process.env.MOVEMENT_RPC_URL || 'https://testnet.movementnetwork.xyz/v1';
        const aptosConfig = new ts_sdk_1.AptosConfig({
            network: ts_sdk_1.Network.CUSTOM,
            fullnode: movRpcUrl,
        });
        const aptos = new ts_sdk_1.Aptos(aptosConfig);
        const privateKey = new ts_sdk_1.Ed25519PrivateKey(movPrivateKeyRaw);
        const movAccount = ts_sdk_1.Account.fromPrivateKey({ privateKey });
        const movAddress = movAccount.accountAddress.toString();
        console.log(chalk_1.default.magenta('🔑 Movement Relayer:'), chalk_1.default.whiteBright(movAddress));
        let moveBalance = 0;
        try {
            const resource = await aptos.getAccountResource({
                accountAddress: movAddress,
                resourceType: "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
            });
            const data = resource;
            moveBalance = Number(data.coin.value) / 1e8; // MOVE has 8 decimals
        }
        catch (e) {
            // Likely no balance or account not found
        }
        console.log(chalk_1.default.magenta('🟣 MOVE Balance:'), chalk_1.default.bold(`${moveBalance.toFixed(4)} MOVE`));
    }
    console.log(chalk_1.default.gray('─'.repeat(50)));
}
main().catch(console.error);
