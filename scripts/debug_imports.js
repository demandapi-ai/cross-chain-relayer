
console.log("DEBUG: Start");
try {
    const path = require('path');
    console.log("DEBUG: CWD", process.cwd());

    require('dotenv').config();
    console.log("DEBUG: Dotenv loaded");

    const anchor = require("@coral-xyz/anchor");
    console.log("DEBUG: Anchor loaded");

    const idlPath = path.resolve(__dirname, '../src/intent_swap.json');
    console.log("DEBUG: IDL Path", idlPath);
    const idl = require(idlPath);
    console.log("DEBUG: IDL loaded");

    const { Keypair } = require("@solana/web3.js");
    console.log("DEBUG: Web3 loaded");

} catch (e) {
    console.error("DEBUG: Crash", e);
}
console.log("DEBUG: End");
