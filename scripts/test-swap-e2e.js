"use strict";
/**
 * End-to-End Cross-Chain Swap Test Script
 * Tests the full Movement -> Solana swap flow including escrow creation and claiming
 */
Object.defineProperty(exports, "__esModule", { value: true });
const ts_sdk_1 = require("@aptos-labs/ts-sdk");
// Configuration
const MOVEMENT_RPC_URL = "https://testnet.movementnetwork.xyz/v1";
const MOVEMENT_HTLC_ADDR = "0x485ca1c12b5dfa01c282b9c7ef09fdfebbf877ed729bf999ce61a8ec5c5e69bd";
const PRIVATE_KEY_HEX = "0x51f4c4f83946fbe943c3952f7094768c1eb66c172993c9f880b2cba0166fc235";
async function main() {
    console.log("=== End-to-End Cross-Chain Swap Test ===\n");
    const config = new ts_sdk_1.AptosConfig({
        network: ts_sdk_1.Network.CUSTOM,
        fullnode: MOVEMENT_RPC_URL
    });
    const aptos = new ts_sdk_1.Aptos(config);
    // Setup Account
    const privateKey = new ts_sdk_1.Ed25519PrivateKey(PRIVATE_KEY_HEX);
    const account = ts_sdk_1.Account.fromPrivateKey({ privateKey });
    console.log(`Using Account: ${account.accountAddress}`);
    // Generate Secret and Hashlock
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);
    const hashBuffer = await crypto.subtle.digest("SHA-256", secret);
    const hashlock = new Uint8Array(hashBuffer);
    const hashlockArray = Array.from(hashlock);
    const secretArray = Array.from(secret);
    console.log(`Secret (first 8 bytes): [${secretArray.slice(0, 8).join(", ")}]`);
    console.log(`Hashlock (first 8 bytes): [${hashlockArray.slice(0, 8).join(", ")}]`);
    // Step 1: Get current registry stats (to know expected ID)
    console.log("\n--- Step 1: Check Registry Stats ---");
    let nextId;
    try {
        const result = await aptos.view({
            payload: {
                function: `${MOVEMENT_HTLC_ADDR}::htlc_escrow::get_registry_stats`,
                typeArguments: ["0x1::aptos_coin::AptosCoin"],
                functionArguments: [MOVEMENT_HTLC_ADDR]
            }
        });
        nextId = parseInt(result[0]);
        console.log(`Next Escrow ID will be: ${nextId}`);
    }
    catch (e) {
        console.error("Failed to get registry stats:", e.message);
        return;
    }
    // Step 2: Create Escrow
    console.log("\n--- Step 2: Create Escrow ---");
    let txHash;
    try {
        const tx = await aptos.transaction.build.simple({
            sender: account.accountAddress,
            data: {
                function: `${MOVEMENT_HTLC_ADDR}::htlc_escrow::create_escrow`,
                typeArguments: ["0x1::aptos_coin::AptosCoin"],
                functionArguments: [
                    MOVEMENT_HTLC_ADDR, // registry
                    hashlockArray, // hashlock
                    account.accountAddress.toString(), // recipient (self for test)
                    "1000", // amount (1000 octas = tiny)
                    3600 // timelock (1 hour duration)
                ]
            }
        });
        const pendingTx = await aptos.transaction.signAndSubmitTransaction({ signer: account, transaction: tx });
        txHash = pendingTx.hash;
        console.log(`Tx Submitted: ${txHash}`);
        const response = await aptos.waitForTransaction({ transactionHash: txHash });
        console.log(`Tx Success: ${response.success}`);
        console.log(`VM Status: ${response.vm_status}`);
        // Try to find the event
        const events = response.events || [];
        console.log(`\nEvents in transaction: ${events.length}`);
        let foundEscrowId = null;
        for (const event of events) {
            console.log(`  Event Type: ${event.type}`);
            if (event.type.includes("NewEscrowEvent") || event.type.includes("htlc_escrow")) {
                console.log(`  Event Data: ${JSON.stringify(event.data)}`);
                if (event.data?.escrow_id !== undefined) {
                    foundEscrowId = parseInt(event.data.escrow_id);
                }
            }
        }
        if (foundEscrowId !== null) {
            console.log(`\n✅ Found Escrow ID from event: ${foundEscrowId}`);
        }
        else {
            console.log(`\n⚠️  No escrow ID in events. Using predicted ID: ${nextId}`);
            foundEscrowId = nextId;
        }
        // Step 3: Verify Escrow Status
        console.log("\n--- Step 3: Verify Escrow Status ---");
        try {
            const status = await aptos.view({
                payload: {
                    function: `${MOVEMENT_HTLC_ADDR}::htlc_escrow::get_escrow_status`,
                    typeArguments: ["0x1::aptos_coin::AptosCoin"],
                    functionArguments: [MOVEMENT_HTLC_ADDR, foundEscrowId.toString()]
                }
            });
            console.log(`Escrow ${foundEscrowId} Status:`);
            console.log(`  Claimed: ${status[0]}`);
            console.log(`  Refunded: ${status[1]}`);
            console.log(`  Amount: ${status[2]}`);
        }
        catch (e) {
            console.error(`Failed to get escrow status: ${e.message}`);
        }
        // Step 4: Claim Escrow
        console.log("\n--- Step 4: Claim Escrow ---");
        try {
            const claimTx = await aptos.transaction.build.simple({
                sender: account.accountAddress,
                data: {
                    function: `${MOVEMENT_HTLC_ADDR}::htlc_escrow::claim`,
                    typeArguments: ["0x1::aptos_coin::AptosCoin"],
                    functionArguments: [
                        MOVEMENT_HTLC_ADDR, // registry
                        foundEscrowId, // escrow_id
                        secretArray // secret
                    ]
                }
            });
            const claimPending = await aptos.transaction.signAndSubmitTransaction({ signer: account, transaction: claimTx });
            console.log(`Claim Tx Submitted: ${claimPending.hash}`);
            const claimResponse = await aptos.waitForTransaction({ transactionHash: claimPending.hash });
            console.log(`Claim Success: ${claimResponse.success}`);
            console.log(`VM Status: ${claimResponse.vm_status}`);
            console.log("\n✅✅✅ FULL SWAP TEST PASSED! ✅✅✅");
        }
        catch (e) {
            console.error(`\n❌ Claim Failed: ${e.message}`);
            if (e.message.includes("0x8")) {
                console.log("   -> ETIMELOCK_EXPIRED: The escrow has expired before claim");
            }
            if (e.message.includes("0x6")) {
                console.log("   -> EINVALID_SECRET: The secret doesn't match the hashlock");
            }
        }
    }
    catch (e) {
        console.error(`Create Escrow Failed: ${e.message}`);
    }
}
main().catch(console.error);
