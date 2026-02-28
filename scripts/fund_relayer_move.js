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
const ts_sdk_1 = require("@aptos-labs/ts-sdk");
const dotenv = __importStar(require("dotenv"));
const chalk_1 = __importDefault(require("chalk"));
const path = __importStar(require("path"));
// Load .env
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });
async function main() {
    console.log(chalk_1.default.cyan('🟣 Fund Relayer MOVE Script'));
    console.log(chalk_1.default.gray('─'.repeat(50)));
    const movPrivateKeyRaw = process.env.MOVEMENT_PRIVATE_KEY;
    if (!movPrivateKeyRaw) {
        throw new Error('Missing MOVEMENT_PRIVATE_KEY in .env');
    }
    const movRpcUrl = process.env.MOVEMENT_RPC_URL || 'https://testnet.movementnetwork.xyz/v1';
    console.log(chalk_1.default.blue(`🌐 RPC: ${movRpcUrl}`));
    // Initialize Aptos Client
    const aptosConfig = new ts_sdk_1.AptosConfig({
        network: ts_sdk_1.Network.CUSTOM,
        fullnode: movRpcUrl,
        faucet: 'https://faucet.testnet.movementnetwork.xyz' // Explicit faucet URL if needed, though SDK handles likely keys
    });
    const aptos = new ts_sdk_1.Aptos(aptosConfig);
    // Get Account
    const privateKey = new ts_sdk_1.Ed25519PrivateKey(movPrivateKeyRaw);
    const account = ts_sdk_1.Account.fromPrivateKey({ privateKey });
    const address = account.accountAddress.toString();
    console.log(chalk_1.default.magenta('🔑 Relayer Address:'), chalk_1.default.whiteBright(address));
    // Check Initial Balance
    let initialBalance = 0;
    try {
        const resource = await aptos.getAccountResource({
            accountAddress: address,
            resourceType: "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
        });
        const data = resource;
        initialBalance = Number(data.coin.value) / 1e8;
        console.log(chalk_1.default.magenta(`💰 Initial Balance: ${initialBalance.toFixed(4)} MOVE`));
    }
    catch (e) {
        console.log(chalk_1.default.yellow('💰 Account not initialized or 0 balance.'));
    }
    const AMOUNT_MOVE = 100000;
    const amountOctas = AMOUNT_MOVE * 1e8;
    console.log(chalk_1.default.cyan(`\n🚰 Requesting ${AMOUNT_MOVE} MOVE from Faucet...`));
    try {
        // Use SDK faucet
        const txn = await aptos.fundAccount({
            accountAddress: address,
            amount: amountOctas
        });
        console.log(chalk_1.default.green('✅ Faucet request sent!'));
        console.log(chalk_1.default.gray(`   Wait response:`, txn));
    }
    catch (error) {
        console.error(chalk_1.default.red('❌ Faucet failed:'), error.message || error);
        console.log(chalk_1.default.yellow('   Note: The testnet faucet often has rate limits or max amount caps (e.g. 10 MOVE).'));
        console.log(chalk_1.default.yellow('   Try requesting a smaller amount if this failed.'));
    }
    // Check Final Balance
    let finalBalance = 0;
    try {
        const resource = await aptos.getAccountResource({
            accountAddress: address,
            resourceType: "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
        });
        const data = resource;
        finalBalance = Number(data.coin.value) / 1e8;
        console.log(chalk_1.default.magenta(`\n💰 Final Balance: ${finalBalance.toFixed(4)} MOVE`));
    }
    catch (e) {
        // Ignore
    }
}
main().catch(console.error);
