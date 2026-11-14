//! orbit-registry — a minimal NEAR contract for the DAiL Swarms entry.
//!
//! It is deliberately SMALL: the point of the deployment is to have a real
//! testnet contract with a real invoice / pay / remittance flow whose
//! transaction hashes resolve live on the NEAR testnet explorer.
//!
//! Flow:
//!   1. `create_invoice(lot_id, amount)`  — the seller opens a lot.
//!   2. `pay_invoice(lot_id)`             — a buyer pays it.
//!   3. `remit(lot_id)`                   — the seller remits the proceeds.
//!
//! Every state change records a monotonically increasing `nonce`, so the
//! explorer shows a distinct transaction per step and the invoice's history
//! is replay-guarded: `pay_invoice` refuses an invoice that is not open, and
//! `remit` refuses an invoice that has already been remitted.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{env, near_bindgen, require, AccountId, NearToken, Promise};
use near_sdk::collections::{LookupMap, UnorderedMap};
use serde::{Deserialize, Serialize};

#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize, PartialEq)]
pub struct Invoice {
    pub lot_id: String,
    pub amount: u128,
    pub seller: AccountId,
    pub payer: Option<AccountId>,
    pub paid: bool,
    pub remitted: bool,
    pub nonce: u64,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[near_bindgen]
pub struct OrbitRegistry {
    invoices: LookupMap<String, Invoice>,
    history: UnorderedMap<u64, String>,
    counter: u64,
}

impl Default for OrbitRegistry {
    fn default() -> Self {
        Self {
            invoices: LookupMap::new(b"i"),
            history: UnorderedMap::new(b"h"),
            counter: 0,
        }
    }
}

#[near_bindgen]
impl OrbitRegistry {
    /// Open a new invoice (a "lot") for `amount` yoctoNEAR.
    #[payable]
    pub fn create_invoice(&mut self, lot_id: String, amount: u128) -> u64 {
        require!(amount > 0, "amount must be positive");
        require!(!self.invoices.get(&lot_id).is_some(), "lot already exists");
        let seller = env::signer_account_id();
        let nonce = self.counter + 1;
        self.counter = nonce;
        let inv = Invoice {
            lot_id: lot_id.clone(),
            amount,
            seller,
            payer: None,
            paid: false,
            remitted: false,
            nonce,
        };
        self.invoices.insert(&lot_id, &inv);
        self.history.insert(&nonce, &lot_id);
        nonce
    }

    /// Pay an open invoice. Exactly once.
    #[payable]
    pub fn pay_invoice(&mut self, lot_id: String) -> u64 {
        let mut inv = self.invoices.get(&lot_id).expect("no such lot");
        require!(!inv.paid, "invoice already paid");
        require!(!inv.remitted, "invoice already remitted");
        let attached = env::attached_deposit();
        require!(attached.as_yoctonear() == inv.amount, "wrong amount attached");
        let payer = env::signer_account_id();
        require!(payer != inv.seller, "seller cannot pay its own invoice");
        inv.paid = true;
        inv.payer = Some(payer);
        let nonce = self.counter + 1;
        self.counter = nonce;
        inv.nonce = nonce;
        self.invoices.insert(&lot_id, &inv);
        self.history.insert(&nonce, &lot_id);
        nonce
    }

    /// Remit the proceeds of a paid invoice to the seller. Exactly once.
    pub fn remit(&mut self, lot_id: String) -> u64 {
        let mut inv = self.invoices.get(&lot_id).expect("no such lot");
        require!(inv.paid, "invoice not paid");
        require!(!inv.remitted, "invoice already remitted");
        let seller = inv.seller.clone();
        let amount = inv.amount;
        inv.remitted = true;
        let nonce = self.counter + 1;
        self.counter = nonce;
        inv.nonce = nonce;
        self.invoices.insert(&lot_id, &inv);
        self.history.insert(&nonce, &lot_id);
        // payout
        Promise::new(seller).transfer(NearToken::from_yoctonear(amount));
        nonce
    }

    /// Read-only view of one invoice.
    pub fn get_invoice(&self, lot_id: String) -> Option<Invoice> {
        self.invoices.get(&lot_id)
    }

    /// Read-only view of the transaction counter.
    pub fn get_counter(&self) -> u64 {
        self.counter
    }

    /// Read-only: the lot id recorded at a given nonce.
    pub fn get_history(&self, nonce: u64) -> Option<String> {
        self.history.get(&nonce)
    }
}
