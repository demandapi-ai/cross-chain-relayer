import { Contract, SignatureTemplate, ElectrumNetworkProvider, TransactionBuilder } from 'cashscript';
import { TestNetWallet } from 'mainnet-js';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import chalk from 'chalk';
import { cashAddressToLockingBytecode, lockingBytecodeToCashAddress } from '@bitauth/libauth';

export class BCHService {
    public provider: ElectrumNetworkProvider;
    public wallet: TestNetWallet | null = null;
    private artifact: any;

    constructor() {
        this.provider = new ElectrumNetworkProvider(config.bch.network as any);

        // Load artifact
        try {
            const artifactPath = path.resolve(config.bch.artifactPath);
            if (!fs.existsSync(artifactPath)) {
                throw new Error(`Artifact not found at ${artifactPath}`);
            }
            this.artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
            console.log(chalk.green('✅ BCH Service: Loaded CrossChainHTLC artifact'));
        } catch (e: any) {
            console.error(chalk.red('❌ Failed to load artifact:'), e.message);
            // Non-fatal if just starting without artifact, but critical for operation
        }
    }

    /**
     * Initialize wallet from file
     */
    async initWallet() {
        try {
            const walletPath = path.resolve(config.bch.walletPath);
            if (!fs.existsSync(walletPath)) {
                throw new Error(`Wallet file not found at ${walletPath}`);
            }
            const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
            this.wallet = await TestNetWallet.fromWIF(walletData.wif);
            console.log(chalk.green(`✅ BCH Service: Wallet initialized (${this.wallet.cashaddr})`));
        } catch (e: any) {
            console.error(chalk.red('❌ Failed to init wallet:'), e.message);
            throw e;
        }
    }

    /**
     * Get instance of HTLC contract
     */
    getContract(
        senderPkh: Uint8Array,     // 20 bytes
        recipientPkh: Uint8Array,  // 20 bytes
        secretHash: Uint8Array,    // 32 bytes
        timelock: bigint           // Unix timestamp
    ): Contract {
        return new Contract(
            this.artifact,
            [senderPkh, recipientPkh, secretHash, timelock],
            { provider: this.provider }
        );
    }

    /**
     * Watch an HTLC address for balance
     */
    async getHTLCBalance(address: string): Promise<bigint> {
        try {
            const utxos = await this.provider.getUtxos(address);
            return utxos.reduce((acc, u) => acc + u.satoshis, 0n);
        } catch (e) {
            return 0n;
        }
    }

    /**
     * Deploy and Fund an HTLC (Solver Action: Lock BCH for User)
     * Used in SOL -> BCH flow
     */
    async lockBCH(
        userAddress: string,    // BCH Address (Recipient)
        hashlock: string,       // Hex string
        amountSats: bigint,
        timelock: bigint
    ): Promise<{ txId: string, contractAddress: string }> {
        if (!this.wallet) throw new Error("Wallet not initialized");

        // Convert parameters
        const relayPkh = await this.getWalletPkh(); // Solver (sender)
        const userPkh = this.derivePkh(userAddress); // User (recipient)
        const hashBuf = Buffer.from(hashlock.replace('0x', ''), 'hex');

        // Instantiate contract
        const contract = this.getContract(
            relayPkh,
            userPkh,
            hashBuf,
            timelock
        );

        console.log(chalk.blue(`   Deploying HTLC at ${contract.address}`));
        console.log(chalk.blue(`   Funding with ${amountSats} sats...`));

        const tx = await this.wallet.send([
            {
                cashaddr: contract.address,
                value: Number(amountSats),
                unit: 'sat'
            } as any
        ]);

        return {
            txId: tx.txId,
            contractAddress: contract.address
        };
    }

    /**
     * Claim an HTLC using the secret (Solver Action: Claim User's locked BCH)
     * Used in BCH -> SOL flow
     */
    async claimHTLC(
        userAddress: string,    // The Maker (Sender)
        hashlock: string,       // Hex string
        secret: string,         // Hex string (preimage)
        timelock: bigint
    ): Promise<string> {
        if (!this.wallet) throw new Error("Wallet not initialized");

        // 1. Reconstruct contract parameters to find address
        // In BCH->SOL flow, User is Sender (Maker), Relayer is Recipient (Taker)
        const makerPkh = this.derivePkh(userAddress);
        const takerPkh = await this.getWalletPkh();
        const hashBuf = Buffer.from(hashlock.replace('0x', ''), 'hex');
        const secretBuf = Buffer.from(secret.replace('0x', ''), 'hex');

        const contract = this.getContract(
            makerPkh,
            takerPkh,
            hashBuf,
            timelock
        );

        // 2. Get UTXOs
        console.log(chalk.blue(`   Checking HTLC address ${contract.address}...`));
        const utxos = await this.provider.getUtxos(contract.address);

        if (utxos.length === 0) {
            throw new Error(`No funds in HTLC ${contract.address}`);
        }

        const balance = utxos.reduce((acc, u) => acc + u.satoshis, 0n);
        console.log(chalk.blue(`   Found ${balance} satoshis in ${utxos.length} UTXOs`));

        // 3. Build Claim Transaction
        const wif = await (this.wallet as any).exportPrivateKeyWif();
        const sigTemplate = new SignatureTemplate(wif);

        console.log(chalk.blue(`   Claiming...`));

        // Fix: Use TransactionBuilder explicitly
        const builder = new TransactionBuilder({ provider: this.provider });

        // Add inputs (all UTXOs)
        // Note: contract.unlock.claim returns an Unlocker
        const unlocker = contract.unlock.claim(
            (this.wallet as any).getPublicKey(),
            sigTemplate,
            secretBuf
        );

        builder.addInputs(utxos, unlocker);

        // Add output (send all to self minus fee)
        builder.addOutput({
            to: this.wallet.cashaddr,
            amount: balance - 2000n
        });

        const tx = await builder.send();
        console.log(chalk.green(`✅ claimed: ${tx.txid}`));
        return tx.txid;
    }

    /**
     * Parse a transaction to find the secret preimage in the scriptSig
     * This is CRITICAL for the Relayer to learn the secret.
     */
    async extractSecret(txId: string): Promise<string | null> {
        try {
            // Fix: Use getRawTransaction and mainnet-js or manual parsing
            // Check if wallet provider has getTransaction (it usually does and returns decoded)
            if (this.wallet && (this.wallet.provider as any).getTransaction) {
                const tx: any = await (this.wallet.provider as any).getTransaction(txId);
                // Loop inputs
                for (const input of tx.inputs) {
                    const scriptHex = input.scriptHex || input.bytecode;
                    if (!scriptHex) continue;
                    const matches = scriptHex.match(/20([0-9a-f]{64})/gi);
                    if (matches) {
                        for (const match of matches) {
                            return match.substring(2);
                        }
                    }
                }
                return null;
            }

            // Fallback to provider.getRawTransaction and manual decode (skip for now if wallet works)
            console.warn("Wallet provider getTransaction not available, skipping secret extraction fallback");
            return null;

        } catch (e) {
            console.error(chalk.red('Failed to extract secret:'), e);
        }
        return null;
    }

    /**
     * Helper: Get history for address
     */
    async getHistory(address: string) {
        if (!this.wallet) return [];
        return (this.wallet.provider as any).getHistory(address);
    }

    /**
     * Helper: Convert address string to P2PKH bytes (20 bytes)
     */
    private derivePkh(address: string): Uint8Array {
        try {
            const lockingBytecode = cashAddressToLockingBytecode(address);
            if (typeof lockingBytecode === 'string') throw new Error(lockingBytecode);

            // Extract P2PKH hash (skip first 3 bytes: 76 a9 14, take next 20)
            // Standard P2PKH script: OP_DUP OP_HASH160 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG
            // 76 a9 14 <hash> 88 ac

            const bytecode = lockingBytecode.bytecode;
            if (bytecode.length === 25 && bytecode[0] === 0x76 && bytecode[1] === 0xa9 && bytecode[2] === 0x14) {
                return bytecode.slice(3, 23);
            }

            throw new Error('Not a standard P2PKH address');
        } catch (e) {
            console.error(chalk.red(`Failed to decode address ${address}`), e);
            throw e;
        }
    }

    /**
     * Helper: Get wallet P2PKH bytes
     */
    private async getWalletPkh(): Promise<Uint8Array> {
        if (!this.wallet) throw new Error("Wallet not initialized");
        const addr = this.wallet.cashaddr;
        return this.derivePkh(addr);
    }
}
