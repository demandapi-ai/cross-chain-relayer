import { Connection, PublicKey } from '@solana/web3.js';
import * as base58 from 'bs58';

async function main() {
    const txId = process.argv[2];
    if (!txId) {
        console.error('Usage: tsx test-sol-tx.ts <txid>');
        process.exit(1);
    }

    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const tx = await connection.getParsedTransaction(txId, { maxSupportedTransactionVersion: 0 });

    if (!tx) {
        console.error('Transaction not found');
        return;
    }

    console.log('Transaction found. Instructions:');

    for (let i = 0; i < tx.transaction.message.instructions.length; i++) {
        const ix = tx.transaction.message.instructions[i];
        console.log(`\nInstruction ${i}:`);
        console.log(`Program ID: ${ix.programId.toString()}`);

        if ('data' in ix) {
            const dataBase58 = ix.data;
            const dataBuf = Buffer.from(base58.decode(dataBase58 as string));
            console.log(`Data (hex): ${dataBuf.toString('hex')}`);
            if (dataBuf.length >= 40) {
                const secretCandidate = dataBuf.slice(8, 40);
                console.log(`Bytes 8-40 (candidate): ${secretCandidate.toString('hex')}`);
            }
        }
    }
}

main().catch(console.error);
