import { MovementService } from './src/services/MovementService';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    console.log('Fetching Escrow 197 details...');
    const mov = new MovementService();
    const details = await mov.getEscrowDetails(197);
    console.log(JSON.stringify(details, null, 2));
}

main().catch(console.error);
