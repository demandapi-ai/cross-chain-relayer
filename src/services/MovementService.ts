import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Account } from '@aptos-labs/ts-sdk';
import { createHash } from 'crypto';
import chalk from 'chalk';
import { config, TOKENS } from '../config';
import { ChainBalance } from '../types/intent';

export class MovementService {
    private client: Aptos;
    public account: Account;
    private htlcAddress: string;

    constructor() {
        const aptosConfig = new AptosConfig({
            network: Network.CUSTOM,
            fullnode: config.movement.rpcUrl,
        });
        this.client = new Aptos(aptosConfig);
        this.htlcAddress = config.movement.htlcAddress;

        // Initialize account from private key
        if (config.movement.privateKey) {
            const privateKey = new Ed25519PrivateKey(config.movement.privateKey);
            this.account = Account.fromPrivateKey({ privateKey });
        } else {
            this.account = Account.generate();
            console.log(chalk.yellow('⚠️  No MOVEMENT_PRIVATE_KEY set. Using ephemeral account.'));
        }

        console.log(chalk.blue(`🔷 Movement Service Initialized: ${this.account.accountAddress.toString()}`));
    }

    /**
     * Create HTLC escrow on Movement
     */
    async createEscrow(
        hashlock: Uint8Array,
        recipient: string,
        amount: bigint,
        timelockDuration: number,
        coinType: string = TOKENS.movement.MOVE
    ): Promise<{ txHash: string; escrowId: number }> {
        console.log(chalk.cyan(`📦 Creating HTLC Escrow on Movement...`));
        console.log(chalk.gray(`   Recipient: ${recipient}`));
        console.log(chalk.gray(`   Amount: ${amount}`));
        console.log(chalk.gray(`   Timelock: ${timelockDuration}s`));

        // Get next escrow ID
        let nextEscrowId = 0;
        try {
            const registryStats = await this.client.view({
                payload: {
                    function: `${this.htlcAddress}::htlc_escrow::get_registry_stats`,
                    typeArguments: ["0x1::aptos_coin::AptosCoin"], // Simplify: assumme MOVE for registry stats
                    functionArguments: [this.htlcAddress]
                }
            });
            // registryStats returns [next_escrow_id, total_locked, total_claimed, total_refunded]
            nextEscrowId = parseInt(registryStats[0] as string);
            console.log(chalk.blue(`   Next Escrow ID to be assigned: ${nextEscrowId}`));
        } catch (e) {
            console.error(chalk.red('Failed to fetch registry stats:'), e);
        }

        const transaction = await this.client.transaction.build.simple({
            sender: this.account.accountAddress,
            data: {
                function: `${this.htlcAddress}::htlc_escrow::create_escrow`,
                typeArguments: [coinType],
                functionArguments: [
                    this.htlcAddress,    // registry_addr
                    Array.from(hashlock), // hashlock
                    recipient,            // recipient
                    amount.toString(),    // amount
                    timelockDuration,     // timelock_duration
                ],
            },
            options: { maxGasAmount: 100000 },
        });

        const committedTx = await this.client.signAndSubmitTransaction({
            signer: this.account,
            transaction,
        });

        const executedTx = await this.client.waitForTransaction({ transactionHash: committedTx.hash });

        console.log(chalk.green(`✅ Movement HTLC Created: ${committedTx.hash}`));

        return { txHash: committedTx.hash, escrowId: nextEscrowId };
    }

    /**
     * Claim escrowed funds with secret
     */
    async claim(
        escrowId: number,
        secret: Uint8Array,
        coinType: string = TOKENS.movement.MOVE
    ): Promise<string> {
        console.log(chalk.cyan(`🔓 Claiming HTLC on Movement (ID: ${escrowId})...`));

        const transaction = await this.client.transaction.build.simple({
            sender: this.account.accountAddress,
            data: {
                function: `${this.htlcAddress}::htlc_escrow::claim`,
                typeArguments: [coinType],
                functionArguments: [
                    this.htlcAddress,     // registry_addr
                    escrowId,             // escrow_id
                    Array.from(secret),   // secret
                ],
            },
            options: { maxGasAmount: 100000 },
        });

        const committedTx = await this.client.signAndSubmitTransaction({
            signer: this.account,
            transaction,
        });

        await this.client.waitForTransaction({ transactionHash: committedTx.hash });
        console.log(chalk.green(`✅ Movement HTLC Claimed: ${committedTx.hash}`));

        return committedTx.hash;
    }

    /**
     * Refund escrowed funds after timelock expires
     */
    async refund(
        escrowId: number,
        coinType: string = TOKENS.movement.MOVE
    ): Promise<string> {
        console.log(chalk.cyan(`↩️ Refunding HTLC on Movement (ID: ${escrowId})...`));

        const transaction = await this.client.transaction.build.simple({
            sender: this.account.accountAddress,
            data: {
                function: `${this.htlcAddress}::htlc_escrow::refund`,
                typeArguments: [coinType],
                functionArguments: [
                    this.htlcAddress,  // registry_addr
                    escrowId,          // escrow_id
                ],
            },
            options: { maxGasAmount: 100000 },
        });

        const committedTx = await this.client.signAndSubmitTransaction({
            signer: this.account,
            transaction,
        });

        await this.client.waitForTransaction({ transactionHash: committedTx.hash });
        console.log(chalk.green(`✅ Movement HTLC Refunded: ${committedTx.hash}`));

        return committedTx.hash;
    }

    /**
     * Get escrow details
     */
    async getEscrowDetails(escrowId: number, coinType: string = TOKENS.movement.MOVE): Promise<any> {
        try {
            const result = await this.client.view({
                payload: {
                    function: `${this.htlcAddress}::htlc_escrow::get_escrow_details`,
                    typeArguments: [coinType],
                    functionArguments: [this.htlcAddress, escrowId],
                },
            });
            return result;
        } catch (e) {
            console.error('Failed to get escrow details:', e);
            return null;
        }
    }

    /**
     * Get relayer balances
     */
    async getBalances(): Promise<ChainBalance[]> {
        const balances: ChainBalance[] = [];

        try {
            const resources = await this.client.getAccountResources({
                accountAddress: this.account.accountAddress
            });

            // MOVE balance
            const moveCoinStore = resources.find(
                (r: any) => r.type === `0x1::coin::CoinStore<${TOKENS.movement.MOVE}>`
            );
            if (moveCoinStore) {
                balances.push({
                    symbol: 'MOVE',
                    balance: parseInt((moveCoinStore.data as any).coin.value) / 1e8,
                    decimals: 8,
                });
            }

            // USDC balance
            const usdcCoinStore = resources.find(
                (r: any) => r.type === `0x1::coin::CoinStore<${TOKENS.movement.USDC}>`
            );
            if (usdcCoinStore) {
                balances.push({
                    symbol: 'USDC',
                    balance: parseInt((usdcCoinStore.data as any).coin.value) / 1e6,
                    decimals: 6,
                });
            }
        } catch (e) {
            console.error('Failed to get Movement balances:', e);
        }

        return balances;
    }

    /**
     * Generate hashlock from secret
     */
    static generateHashlock(secret: Uint8Array): Uint8Array {
        return createHash('sha256').update(secret).digest();
    }

    /**
     * Generate random secret (32 bytes)
     */
    static generateSecret(): Uint8Array {
        const secret = new Uint8Array(32);
        crypto.getRandomValues(secret);
        return secret;
    }
}
