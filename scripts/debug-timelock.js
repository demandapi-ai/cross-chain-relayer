"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts_sdk_1 = require("@aptos-labs/ts-sdk");
// Configuration
const MOVEMENT_RPC_URL = "https://testnet.movementnetwork.xyz/v1";
const MOVEMENT_HTLC_ADDR = "0x485ca1c12b5dfa01c282b9c7ef09fdfebbf877ed729bf999ce61a8ec5c5e69bd";
const PRIVATE_KEY_HEX = "0x51f4c4f83946fbe943c3952f7094768c1eb66c172993c9f880b2cba0166fc235"; // From .env
async function main() {
    console.log("=== Debugging Timelock Logic (Part 4) ===");
    console.log("Hypothesis: Contract expects MILLISECONDS.");
    const config = new ts_sdk_1.AptosConfig({
        network: ts_sdk_1.Network.CUSTOM,
        fullnode: MOVEMENT_RPC_URL
    });
    const aptos = new ts_sdk_1.Aptos(config);
    // Setup Account
    const privateKey = new ts_sdk_1.Ed25519PrivateKey(PRIVATE_KEY_HEX);
    const account = ts_sdk_1.Account.fromPrivateKey({ privateKey });
    console.log(`Using Account: ${account.accountAddress}`);
    // Generate Hashlock
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);
    const hashBuffer = await crypto.subtle.digest("SHA-256", secret);
    const hashlock = new Uint8Array(hashBuffer);
    const hashlockArray = Array.from(hashlock);
    // Test H: Block Height (Height + 1000)
    console.log("\n--- TEST H: Sending Block Height (Height + 1000) ---");
    try {
        const ledger = await aptos.getLedgerInfo();
        const height = parseInt(ledger.block_height);
        const timelock = height + 1000;
        console.log(`Using Height: ${timelock} (Current Height: ${height})`);
        const tx = await aptos.transaction.build.simple({
            sender: account.accountAddress,
            data: {
                function: `${MOVEMENT_HTLC_ADDR}::htlc_escrow::create_escrow`,
                typeArguments: ["0x1::aptos_coin::AptosCoin"],
                functionArguments: [MOVEMENT_HTLC_ADDR, hashlockArray, account.accountAddress.toString(), "100", timelock]
            }
        });
        const pendingTx = await aptos.transaction.signAndSubmitTransaction({ signer: account, transaction: tx });
        console.log(`Tx H Submitted: ${pendingTx.hash}`);
        const response = await aptos.waitForTransaction({ transactionHash: pendingTx.hash });
        console.log(`Test H Success: ${response.success}, VM Status: ${response.vm_status}`);
    }
    catch (e) {
        console.error("FAILED Test H:", e.message || e);
        if (JSON.stringify(e).includes("0xa"))
            console.log("-> 0xa (INVALID)");
        if (JSON.stringify(e).includes("0x8"))
            console.log("-> 0x8 (EXPIRED)");
    }
}
main().catch(console.error);
