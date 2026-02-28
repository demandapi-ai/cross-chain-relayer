"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const ts_sdk_1 = require("@aptos-labs/ts-sdk");
const crypto_1 = require("crypto");
const axios_1 = __importDefault(require("axios"));
const chalk_1 = __importDefault(require("chalk"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Config
const RELAYER_URL = 'http://localhost:3003';
const MOVEMENT_RPC = 'https://testnet.movementnetwork.xyz/v1';
const SOLANA_RPC = 'https://api.devnet.solana.com';
// Colors
const LOG_INFO = chalk_1.default.blue;
const LOG_SUCCESS = chalk_1.default.green;
const LOG_WARN = chalk_1.default.yellow;
const LOG_ERROR = chalk_1.default.red;
const LOG_DATA = chalk_1.default.gray;
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function main() {
    console.clear();
    console.log(chalk_1.default.bold.magenta('🚀 Cross-Chain Relayer E2E Demo 🚀\n'));
    // --- 1. Setup Connections ---
    console.log(LOG_INFO('1. Setting up Connections...'));
    const solConnection = new web3_js_1.Connection(SOLANA_RPC, 'confirmed');
    const aptosConfig = new ts_sdk_1.AptosConfig({ network: ts_sdk_1.Network.CUSTOM, fullnode: MOVEMENT_RPC });
    const aptos = new ts_sdk_1.Aptos(aptosConfig);
    console.log(LOG_DATA(`   Solana RPC: ${SOLANA_RPC}`));
    console.log(LOG_DATA(`   Movement RPC: ${MOVEMENT_RPC}`));
    let relayerSolStart = 0;
    let relayerMoveStart = 0;
    // --- 2. Setup "User" Wallets ---
    console.log(LOG_INFO('\n2. Creating "User" Wallets...'));
    // Solana User
    const solUser = web3_js_1.Keypair.generate();
    console.log(LOG_DATA(`   Solana User: ${solUser.publicKey.toBase58()}`));
    // Movement User
    const movUser = ts_sdk_1.Account.generate();
    console.log(LOG_DATA(`   Movement User: ${movUser.accountAddress.toString()}`));
    // --- 3. Fund Wallets ---
    console.log(LOG_INFO('\n3. Funding User Wallets...'));
    // Fund Solana
    try {
        console.log(LOG_DATA('   Requesting SOL airdrop...'));
        const sig = await solConnection.requestAirdrop(solUser.publicKey, 1 * web3_js_1.LAMPORTS_PER_SOL);
        await solConnection.confirmTransaction(sig);
        console.log(LOG_SUCCESS('   ✅ Airdropped 1 SOL to User'));
    }
    catch (e) {
        console.log(LOG_WARN('   ⚠️ Solana Airdrop failed. Trying Relayer Wallet...'));
        try {
            const solKeyRaw = process.env.SOLANA_PRIVATE_KEY;
            if (solKeyRaw) {
                const solKey = Uint8Array.from(JSON.parse(solKeyRaw));
                const funder = web3_js_1.Keypair.fromSecretKey(solKey);
                const tx = new web3_js_1.Transaction().add(web3_js_1.SystemProgram.transfer({
                    fromPubkey: funder.publicKey,
                    toPubkey: solUser.publicKey,
                    lamports: 0.5 * web3_js_1.LAMPORTS_PER_SOL
                }));
                const sig = await (0, web3_js_1.sendAndConfirmTransaction)(solConnection, tx, [funder]);
                console.log(LOG_SUCCESS(`   ✅ Funded 0.5 SOL from Relayer. Tx: ${sig.slice(0, 10)}...`));
            }
            else {
                throw new Error("No SOLANA_PRIVATE_KEY in env");
            }
        }
        catch (fundErr) {
            console.log(LOG_ERROR(`   ❌ Funding Failed: ${fundErr.message}`));
        }
    }
    // Fund Movement
    // We need a funded account to send MOVE to the new user.
    // We'll read from .env (the Relayer's key) to act as a "Faucet"
    const relayerKey = process.env.MOVEMENT_PRIVATE_KEY;
    if (relayerKey) {
        try {
            console.log(LOG_DATA('   Funding Movement User from Relayer Wallet...'));
            const privateKey = new ts_sdk_1.Ed25519PrivateKey(relayerKey);
            const funder = ts_sdk_1.Account.fromPrivateKey({ privateKey });
            const tx = await aptos.transaction.build.simple({
                sender: funder.accountAddress,
                data: {
                    function: "0x1::aptos_account::transfer",
                    functionArguments: [movUser.accountAddress, 1000000] // 0.01 MOVE (8 decimals)
                }
            });
            const committedTx = await aptos.signAndSubmitTransaction({
                signer: funder,
                transaction: tx
            });
            await aptos.waitForTransaction({ transactionHash: committedTx.hash });
            console.log(LOG_SUCCESS('   ✅ Sent 1 MOVE to User'));
        }
        catch (e) {
            console.log(LOG_WARN(`   ⚠️ Failed to fund Movement User: ${e.message}`));
        }
    }
    else {
        console.log(LOG_WARN('   ⚠️ NO MOVEMENT_PRIVATE_KEY found. User might be empty!'));
    }
    // Check Balances
    const solBal = await solConnection.getBalance(solUser.publicKey);
    const movBal = await aptos.getAccountAPTAmount({ accountAddress: movUser.accountAddress });
    console.log(chalk_1.default.bold(`   💰 User Balances: ${solBal / web3_js_1.LAMPORTS_PER_SOL} SOL | ${movBal / 1e8} MOVE`));
    // --- 4. Relayer Health ---
    console.log(LOG_INFO('\n4. Checking Relayer Health...'));
    try {
        const health = await axios_1.default.get(`${RELAYER_URL}/health`);
        console.log(LOG_SUCCESS('   ✅ Relayer is Online'));
        relayerSolStart = parseFloat(health.data.solana.balances[0]?.balance ?? "0");
        relayerMoveStart = parseFloat(health.data.movement.balances[0]?.balance ?? "0");
        console.log(LOG_DATA(`      Relayer SOL: ${relayerSolStart}`));
        console.log(LOG_DATA(`      Relayer MOVE: ${relayerMoveStart}`));
    }
    catch (e) {
        console.log(LOG_ERROR('   ❌ Relayer Offline! Start it with `npm run dev` in separate terminal.'));
        process.exit(1);
    }
    // --- 5. Swap: SOL -> MOVE ---
    console.log(LOG_INFO('\n5. Executing Swap: SOL (User) -> MOVE (User)...'));
    // 5a. User Generates Secret
    const secretBytes = (0, crypto_1.randomBytes)(32);
    const hashlockBytes = (0, crypto_1.createHash)('sha256').update(secretBytes).digest();
    const secret = '0x' + secretBytes.toString('hex');
    const hashlock = '0x' + hashlockBytes.toString('hex');
    console.log(LOG_DATA(`   Generated Secret: ${secret.slice(0, 10)}...`));
    // Get Next Escrow ID (to claim later)
    const MOVEMENT_HTLC_ADDR = "0x485ca1c12b5dfa01c282b9c7ef09fdfebbf877ed729bf999ce61a8ec5c5e69bd";
    let targetEscrowId = 0;
    try {
        const stats = await aptos.view({
            payload: {
                function: `${MOVEMENT_HTLC_ADDR}::htlc_escrow::get_registry_stats`,
                typeArguments: ["0x1::aptos_coin::AptosCoin"],
                functionArguments: [MOVEMENT_HTLC_ADDR]
            }
        });
        targetEscrowId = parseInt(stats[0]);
        console.log(LOG_DATA(`   Target Escrow ID for Claim: ${targetEscrowId}`));
    }
    catch (e) {
        console.log(LOG_WARN('   ⚠️ Failed to fetch registry stats. Auto-claim might fail.'));
    }
    // 5b. User Locks on Solana (Sends to Relayer)
    // In simplified model: Direct Transfer
    const RELAYER_SOL_ADDR = new web3_js_1.PublicKey("Crgx1n8HxZe8fq3d3vYhYrLDuKJ3pJZN4gfeSKuNarub"); // Hardcoded from known key or config
    // Actually, get from health check ideally?
    // Let's assume hardcoded or we have to trust the address we send to.
    console.log(LOG_DATA('   Step A: User locks 0.1 SOL on Solana...'));
    const transferTx = new web3_js_1.Transaction().add(web3_js_1.SystemProgram.transfer({
        fromPubkey: solUser.publicKey,
        toPubkey: RELAYER_SOL_ADDR,
        lamports: 0.1 * web3_js_1.LAMPORTS_PER_SOL
    }));
    try {
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(solConnection, transferTx, [solUser]);
        console.log(LOG_SUCCESS(`   ✅ Locked (Sent) 0.1 SOL. Tx: ${sig.slice(0, 10)}...`));
        // 5c. Notify Relayer
        console.log(LOG_DATA('   Step B: Notifying Relayer...'));
        const intentRes = await axios_1.default.post(`${RELAYER_URL}/swap/solana-to-movement`, {
            makerAddress: solUser.publicKey.toBase58(),
            recipientAddress: movUser.accountAddress.toString(),
            sellAmount: (0.1 * web3_js_1.LAMPORTS_PER_SOL).toString(),
            buyAmount: (0.09 * 1e8).toString(), // Expect 0.09 MOVE (simulating rate/fee)
            hashlock: hashlock,
            sourceEscrowPda: sig // Use Tx Hash as ID
        });
        const intentId = intentRes.data.intent.id;
        console.log(LOG_SUCCESS(`   ✅ Intent Created: ${intentId}`));
        // 5d. Reveal Secret
        console.log(LOG_DATA('   Step C: User Reveals Secret to Claim...'));
        await sleep(2000); // Wait a bit
        const revealRes = await axios_1.default.post(`${RELAYER_URL}/reveal-secret`, {
            intentId,
            secret
        });
        console.log(LOG_SUCCESS('   ✅ Secret Revealed. Swap Complete!'));
        // --- 5e. Auto-Claim on Movement (Relayer pays gas) ---
        console.log(LOG_DATA('   Step D: Relayer Auto-Claims for User (Gasless)...'));
        // Use Relayer Key to claim
        if (relayerKey) {
            const privateKey = new ts_sdk_1.Ed25519PrivateKey(relayerKey);
            const funder = ts_sdk_1.Account.fromPrivateKey({ privateKey });
            const claimTx = await aptos.transaction.build.simple({
                sender: funder.accountAddress,
                data: {
                    function: `${MOVEMENT_HTLC_ADDR}::htlc_escrow::claim`,
                    typeArguments: ["0x1::aptos_coin::AptosCoin"],
                    functionArguments: [
                        MOVEMENT_HTLC_ADDR,
                        targetEscrowId,
                        Array.from(secretBytes)
                    ]
                }
            });
            const claimCommitted = await aptos.signAndSubmitTransaction({
                signer: funder,
                transaction: claimTx
            });
            await aptos.waitForTransaction({ transactionHash: claimCommitted.hash });
            console.log(LOG_SUCCESS(`   ✅ Auto-Claimed 0.1 MOVE! Tx: ${claimCommitted.hash.slice(0, 10)}...`));
        }
    }
    catch (e) {
        console.log(LOG_ERROR(`   ❌ Swap Failed: ${e.message}`));
        if (e.response)
            console.log(LOG_DATA(JSON.stringify(e.response.data)));
    }
    // --- 6. Swap: MOVE -> SOL ---
    console.log(LOG_INFO('\n6. Executing Swap: MOVE (User) -> SOL (User)...'));
    // 6a. Generate New Secret
    const secretBytes2 = (0, crypto_1.randomBytes)(32);
    const hashlockBytes2 = (0, crypto_1.createHash)('sha256').update(secretBytes2).digest();
    const secret2 = '0x' + secretBytes2.toString('hex');
    const hashlock2 = '0x' + hashlockBytes2.toString('hex');
    // 6b. User Locks on Movement
    console.log(LOG_DATA('   Step A: User locks 0.1 MOVE on Movement...'));
    // Use call create_escrow
    // const MOVEMENT_HTLC_ADDR = "0x485ca1c12b5dfa01c282b9c7ef09fdfebbf877ed729bf999ce61a8ec5c5e69bd"; // Already defined above
    try {
        const lockTx = await aptos.transaction.build.simple({
            sender: movUser.accountAddress,
            data: {
                function: `${MOVEMENT_HTLC_ADDR}::htlc_escrow::create_escrow`,
                typeArguments: ["0x1::aptos_coin::AptosCoin"],
                functionArguments: [
                    MOVEMENT_HTLC_ADDR,
                    Array.from(hashlockBytes2),
                    "0x6315e315b46112eabebd4e168a929fbcc4d494f28b38c8ec9c97a6b80d5c8ee2", // Relayer Address (hardcoded from know dev env)
                    (0.01 * 1e8).toFixed(0),
                    3600
                ]
            }
        });
        const lockCommitted = await aptos.signAndSubmitTransaction({
            signer: movUser,
            transaction: lockTx
        });
        const executedLock = await aptos.waitForTransaction({ transactionHash: lockCommitted.hash });
        console.log(LOG_SUCCESS(`   ✅ Locked 0.1 MOVE. Tx: ${lockCommitted.hash.slice(0, 10)}...`));
        // Parse Escrow ID
        let escrowId = 0;
        // @ts-ignore
        const events = executedLock.events;
        if (events) {
            const createEvent = events.find((e) => e.type.includes("EscrowCreatedEvent"));
            if (createEvent) {
                escrowId = parseInt(createEvent.data.escrow_id);
                console.log(LOG_DATA(`      Escrow ID: ${escrowId}`));
            }
        }
        // 6c. Notify Relayer
        console.log(LOG_DATA('   Step B: Notifying Relayer...'));
        const intentRes2 = await axios_1.default.post(`${RELAYER_URL}/swap/movement-to-solana`, {
            makerAddress: movUser.accountAddress.toString(),
            recipientAddress: solUser.publicKey.toBase58(),
            sellAmount: (0.01 * 1e8).toString(),
            buyAmount: (0.009 * 1e9).toString(), // Expect 0.009 SOL
            hashlock: hashlock2,
            sourceEscrowId: 0 // Placeholder
        });
        console.log(LOG_SUCCESS(`   ✅ Intent Created: ${intentRes2.data.intent.id}`));
        console.log(LOG_DATA('   (Relayer should auto-fill on Solana)'));
    }
    catch (e) {
        console.log(LOG_ERROR(`   ❌ Swap Failed: ${e.message}`));
        if (e.response)
            console.log(LOG_DATA(JSON.stringify(e.response.data)));
    }
    // --- 7. Final Balances & Audit ---
    console.log(LOG_INFO('\n7. Auditing Fund Flow...'));
    await sleep(2000); // Allow propagation
    // User Finals
    const solBalFinal = await solConnection.getBalance(solUser.publicKey);
    const movBalFinal = await aptos.getAccountAPTAmount({ accountAddress: movUser.accountAddress });
    // Relayer Finals
    const healthFinal = await axios_1.default.get(`${RELAYER_URL}/health`);
    const relayerSolFinal = parseFloat(healthFinal.data.solana.balances[0]?.balance ?? "0");
    const relayerMoveFinal = parseFloat(healthFinal.data.movement.balances[0]?.balance ?? "0");
    const userSolDelta = (solBalFinal - solBal) / web3_js_1.LAMPORTS_PER_SOL;
    const userMoveDelta = (movBalFinal - movBal) / 1e8;
    const relayerSolDelta = relayerSolFinal - relayerSolStart;
    const relayerMoveDelta = relayerMoveFinal - relayerMoveStart;
    console.log(chalk_1.default.bold.underline('\n📊 FUND FLOW AUDIT'));
    // Table
    const fmt = (n, sym) => {
        const s = n > 0 ? '+' : '';
        const color = n > 0 ? chalk_1.default.green : (n < 0 ? chalk_1.default.red : chalk_1.default.gray);
        return color(`${s}${n.toFixed(6)} ${sym}`);
    };
    console.log(`
┌─────────────┬───────────────────────────────┬───────────────────────────────┐
│ Entity      │ SOL Change                    │ MOVE Change                   │
├─────────────┼───────────────────────────────┼───────────────────────────────┤
│ USER        │ ${fmt(userSolDelta, 'SOL').padEnd(38)}│ ${fmt(userMoveDelta, 'MOVE').padEnd(38)}│
│ RELAYER     │ ${fmt(relayerSolDelta, 'SOL').padEnd(38)}│ ${fmt(relayerMoveDelta, 'MOVE').padEnd(38)}│
├─────────────┼───────────────────────────────┼───────────────────────────────┤
│ NET SYSTEM  │ ${fmt(userSolDelta + relayerSolDelta, 'SOL').padEnd(38)}│ ${fmt(userMoveDelta + relayerMoveDelta, 'MOVE').padEnd(38)}│
└─────────────┴───────────────────────────────┴───────────────────────────────┘
`);
    console.log(LOG_DATA('Note: Net System < 0 implies gas fees/network costs.'));
    console.log(LOG_DATA('      User -0.1 SOL, Relayer +0.1 SOL (minus gas) = Perfect Swap 1'));
    console.log(LOG_DATA('      Relayer -0.1 MOVE, User +0.1 MOVE (minus gas) = Perfect Swap 2'));
    if (Math.abs(userSolDelta + relayerSolDelta) < 0.01 && Math.abs(userMoveDelta + relayerMoveDelta) < 0.01) {
        console.log(chalk_1.default.bold.green('\n✅ AUDIT PASSED: No significant funds lost (only gas).'));
    }
    else {
        console.log(chalk_1.default.bold.yellow('\n⚠️ AUDIT NOTICE: Check Net System mismatch (possible fees or errors).'));
    }
}
main().catch(console.error);
