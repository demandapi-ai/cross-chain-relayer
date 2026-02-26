import { Contract, SignatureTemplate, ElectrumNetworkProvider, TransactionBuilder } from 'cashscript';
import { TestNetWallet } from 'mainnet-js';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import dotenv from 'dotenv';
dotenv.config();

// Minimal BCH HTLC test: lock + claim with detailed logging. No Movement needed.
async function main() {
    console.log('=== BCH HTLC Lock + Claim Diagnostic ===\n');

    // 1. Load artifact
    const artifactPath = path.resolve('../contracts-bch-crosschain/artifacts/CrossChainHTLC.json');
    if (!fs.existsSync(artifactPath)) {
        console.error('Missing artifact: artifacts/CrossChainHTLC.json');
        process.exit(1);
    }
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    console.log('Artifact loaded OK');

    // 2. Create provider
    const provider = new ElectrumNetworkProvider('chipnet');

    // 3. Two wallets: sender (locks funds) and recipient (claims funds)
    const userKeyFile = 'user_keys.json';
    if (!fs.existsSync(userKeyFile)) {
        console.error('Missing user_keys.json — run setup-e2e.ts first');
        process.exit(1);
    }
    const userKeys = JSON.parse(fs.readFileSync(userKeyFile, 'utf-8'));

    const senderWallet = await TestNetWallet.fromWIF(userKeys.bchWif);
    const recipientWallet = await TestNetWallet.fromWIF(process.env.BCH_NODE_WIF!);

    console.log(`Sender:    ${senderWallet.cashaddr}`);
    console.log(`Recipient: ${recipientWallet.cashaddr}`);

    const senderBal = await senderWallet.getBalance('sat');
    const recipientBal = await recipientWallet.getBalance('sat');
    console.log(`Sender Balance:    ${senderBal} sats`);
    console.log(`Recipient Balance: ${recipientBal} sats`);

    if (senderBal < 10000) {
        console.error('Sender needs at least 10000 sats');
        process.exit(1);
    }

    // 4. Derive PKH for each
    function derivePkh(address: string): Uint8Array {
        const lockingBytecode = cashAddressToLockingBytecode(address);
        if (typeof lockingBytecode === 'string') throw new Error(lockingBytecode);
        const bytecode = lockingBytecode.bytecode;
        if (bytecode.length === 25 && bytecode[0] === 0x76 && bytecode[1] === 0xa9 && bytecode[2] === 0x14) {
            return bytecode.slice(3, 23);
        }
        throw new Error('Not a standard P2PKH address');
    }

    const senderPkh = derivePkh(senderWallet.cashaddr!);
    const recipientPkh = derivePkh(recipientWallet.cashaddr!);

    console.log(`\nSender PKH:    ${Buffer.from(senderPkh).toString('hex')}`);
    console.log(`Recipient PKH: ${Buffer.from(recipientPkh).toString('hex')}`);

    // 5. Generate secret + hashlock
    const secret = Buffer.from('a'.repeat(64), 'hex'); // deterministic for debugging
    const hashlock = createHash('sha256').update(secret).digest();
    console.log(`Secret:   ${secret.toString('hex')}`);
    console.log(`Hashlock: ${hashlock.toString('hex')}`);

    // 6. Set up timelock (far future)
    const timelock = BigInt(Math.floor(Date.now() / 1000) + 7200);
    console.log(`Timelock: ${timelock}`);

    // 7. Build contract
    const contract = new Contract(
        artifact,
        [senderPkh, recipientPkh, hashlock, timelock],
        { provider }
    );
    console.log(`\nContract Address: ${contract.address}`);

    // 8. Fund the contract from sender's wallet
    const lockAmount = 5000;
    console.log(`\nLocking ${lockAmount} sats into contract...`);
    const fundTx = await senderWallet.send([{
        cashaddr: contract.address,
        value: lockAmount,
        unit: 'sat'
    } as any]);
    console.log(`Fund TX: ${fundTx.txId}`);

    // Wait a bit for propagation
    await new Promise(r => setTimeout(r, 3000));

    // 9. Verify contract has funds
    const utxos = await provider.getUtxos(contract.address);
    const balance = utxos.reduce((acc, u) => acc + u.satoshis, 0n);
    console.log(`Contract balance: ${balance} sats (${utxos.length} UTXOs)`);

    if (balance <= 0n) {
        console.error('Contract has no funds — funding failed?');
        process.exit(1);
    }

    // 10. Claim from recipient's wallet
    console.log('\n=== CLAIMING ===');

    // Reconstruct same contract with same params
    const claimContract = new Contract(
        artifact,
        [senderPkh, recipientPkh, hashlock, timelock],
        { provider }
    );
    console.log(`Claim contract address: ${claimContract.address}`);
    console.log(`Addresses match: ${contract.address === claimContract.address}`);

    // Get recipient's private key and public key
    const recipientWif = (recipientWallet as any).privateKeyWif;
    console.log(`Recipient WIF exists: ${!!recipientWif}`);
    const sigTemplate = new SignatureTemplate(recipientWif);
    const recipientPubKey = sigTemplate.getPublicKey();

    console.log(`Recipient PubKey (${recipientPubKey.length} bytes): ${Buffer.from(recipientPubKey).toString('hex')}`);

    // Verify: hash160(recipientPubKey) should equal recipientPkh
    const hash160 = createHash('ripemd160').update(
        createHash('sha256').update(recipientPubKey).digest()
    ).digest();
    console.log(`hash160(recipientPubKey): ${hash160.toString('hex')}`);
    console.log(`recipientPkh:            ${Buffer.from(recipientPkh).toString('hex')}`);
    console.log(`Match: ${hash160.toString('hex') === Buffer.from(recipientPkh).toString('hex')}`);

    if (hash160.toString('hex') !== Buffer.from(recipientPkh).toString('hex')) {
        console.error('\n❌ CRITICAL: PubKey does not hash to recipientPkh!');
        console.error('This means the SignatureTemplate is using a different key than the address.');
        process.exit(1);
    }

    // Build claim transaction
    const claimUtxos = await provider.getUtxos(claimContract.address);
    const claimBalance = claimUtxos.reduce((acc, u) => acc + u.satoshis, 0n);
    console.log(`\nClaiming ${claimBalance} sats...`);

    const unlocker = claimContract.unlock.claim(
        recipientPubKey,
        sigTemplate,
        secret
    );

    const builder = new TransactionBuilder({ provider });
    builder.addInputs(claimUtxos, unlocker);

    const fee = 1000n;
    const outputAmount = claimBalance - fee;
    console.log(`Output: ${outputAmount} sats (fee: ${fee})`);

    if (outputAmount < 546n) {
        console.error(`Output ${outputAmount} is below dust limit (546 sats)`);
        process.exit(1);
    }

    builder.addOutput({
        to: recipientWallet.cashaddr,
        amount: outputAmount
    });

    try {
        const tx = await builder.send();
        console.log(`\n✅ CLAIM SUCCESSFUL! TX: ${tx.txid}`);
    } catch (e: any) {
        console.error(`\n❌ CLAIM FAILED: ${e.message}`);
        if (e.reason) console.error(`Reason: ${e.reason}`);
        // Try debug
        try {
            const debugResult = await builder.debug();
            console.error('Debug info:', JSON.stringify(debugResult, null, 2));
        } catch (d) {
            // ignore debug errors
        }
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
