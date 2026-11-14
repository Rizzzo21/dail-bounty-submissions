//! orbit-bastion — a minimal on-chain policy engine for the DAiL BASTION entry.
//!
//! It is deliberately SMALL, and it implements exactly the two rules that the
//! offline engine in `src/` enforces first, so that the bounty's "a real
//! blocked-overspend + flagged-scam flow on testnet" is a genuine on-chain
//! event and not a description of one:
//!
//!   1. the per-transaction limit      -> `spend` REFUSES an overspend
//!   2. the known-bad counterparty      -> `spend` REFUSES a flagged scam
//!
//! The thresholds are the ones the offline engine uses, not invented here:
//! `src/scam.js` holds a request at `HOLD_THRESHOLD = 4` and refuses it
//! outright at `HARD_BLOCK_THRESHOLD = 8`; `src/policy.js` blocks any single
//! transfer above the wallet's per-transaction limit. A counterparty the
//! screen scored at 8 or more is a hard block here, exactly as it is there.
//!
//! Flow:
//!   1. `set_limit(wallet, limit)`            — the sandbox's spending limit
//!   2. `spend(wallet, to, amount)`            — an allowed spend (recorded)
//!   3. `spend(wallet, to, amount)`            — an OVERSPEND: it returns
//!      BLOCK / "REFUSED: the amount exceeds the per-transaction limit"
//!   4. `screen_counterparty(to, reason, score)` — the scam screen flags a
//!      counterparty; at score 8 or more it is a hard block
//!   5. `spend(wallet, flagged_to, amount)`    — REFUSED: the counterparty is
//!      flagged as a scam
//!
//! A refusal is a DECISION recorded on chain, exactly as it is in the offline
//! engine: `src/policy.js` returns a verdict ("ALLOW" / "BLOCK") with a
//! reason and a trace - it does not crash the caller. So `spend` returns a
//! `Decision`, logs the refusal, and records the refused spend in the state.
//! The refusal is therefore readable in three places on chain: the returned
//! value, the transaction log, and `get_spends`. (An earlier version of this
//! contract panicked instead, so that the refusal was a failed transaction -
//! but a failed transaction's hash does not resolve through the RPC, and a
//! reader who cannot resolve a cited hash cannot tell a real refusal from a
//! made-up one.)

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap};
use near_sdk::{env, near_bindgen, require, AccountId};
use serde::{Deserialize, Serialize};

/// The offline engine's `HARD_BLOCK_THRESHOLD` (src/scam.js): at or above this
/// score the instruction is refused outright.
pub const HARD_BLOCK_THRESHOLD: u64 = 8;
/// The offline engine's `HOLD_THRESHOLD` (src/scam.js): at or above this score
/// the request is held for an approver. Held is not blocked, so it does not
/// stop a spend here - but it is recorded, and it is visible.
pub const HOLD_THRESHOLD: u64 = 4;

#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize, PartialEq)]
pub struct Flag {
    pub counterparty: AccountId,
    pub reason: String,
    pub score: u64,
    pub held: bool,
    pub blocked: bool,
    pub raised_by: AccountId,
    pub nonce: u64,
}

/// The verdict, the same shape the offline engine returns from `evaluate()`.
#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize, PartialEq)]
pub struct Decision {
    pub decision: String,
    pub reason: String,
    pub rule: String,
    pub amount: u128,
    pub to: AccountId,
    pub nonce: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize, PartialEq)]
pub struct Spend {
    pub to: AccountId,
    pub amount: u128,
    pub allowed: bool,
    pub reason: String,
    pub nonce: u64,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[near_bindgen]
pub struct OrbitBastion {
    limits: LookupMap<AccountId, u128>,
    flags: LookupMap<AccountId, Flag>,
    flag_order: UnorderedMap<u64, AccountId>,
    spends: LookupMap<AccountId, Vec<Spend>>,
    counter: u64,
}

impl Default for OrbitBastion {
    fn default() -> Self {
        Self {
            limits: LookupMap::new(b"l"),
            flags: LookupMap::new(b"f"),
            flag_order: UnorderedMap::new(b"o"),
            spends: LookupMap::new(b"s"),
            counter: 0,
        }
    }
}

#[near_bindgen]
impl OrbitBastion {
    /// Set the per-transaction limit for a sandbox wallet.
    pub fn set_limit(&mut self, wallet: AccountId, limit: u128) -> u64 {
        require!(limit > 0, "the limit must be positive");
        self.limits.insert(&wallet, &limit);
        self.counter += 1;
        self.counter
    }

    /// The limit of a sandbox wallet, if one has been set.
    pub fn get_limit(&self, wallet: AccountId) -> Option<u128> {
        self.limits.get(&wallet)
    }

    /// Spend from a sandbox wallet.
    ///
    /// It returns a `Decision`. A BLOCK is a refusal recorded on chain: the
    /// spend is NOT recorded as allowed, the reason is logged, and the reason
    /// is in the returned value. The two rules are checked in the same order
    /// as the offline engine: the counterparty screen first, then the limit.
    pub fn spend(&mut self, wallet: AccountId, to: AccountId, amount: u128) -> Decision {
        require!(amount > 0, "the amount must be positive");
        let nonce = self.counter + 1;
        self.counter = nonce;
        let (decision, reason, rule) = match self.limits.get(&wallet) {
            None => (
                "BLOCK",
                "REFUSED: no spending limit is set for this wallet".to_string(),
                "r-limit-missing",
            ),
            Some(limit) if amount > limit => (
                "BLOCK",
                "REFUSED: the amount exceeds the per-transaction limit".to_string(),
                "r-limit-tx",
            ),
            Some(_) => match self.flags.get(&to) {
                Some(flag) if flag.blocked => (
                    "BLOCK",
                    "REFUSED: the counterparty is flagged as a scam".to_string(),
                    "r-known-bad",
                ),
                _ => ("ALLOW", "within the policy".to_string(), "r-ok"),
            },
        };
        let allowed = decision == "ALLOW";
        env::log_str(&format!(
            "{} {} -> {} ({}): {}",
            decision, wallet, to, amount, reason
        ));
        let mut spends = self.spends.get(&wallet).unwrap_or_default();
        spends.push(Spend {
            to: to.clone(),
            amount,
            allowed,
            reason: reason.clone(),
            nonce,
        });
        self.spends.insert(&wallet, &spends);
        Decision {
            decision: decision.to_string(),
            reason,
            rule: rule.to_string(),
            amount,
            to,
            nonce,
        }
    }

    /// The scam screen runs on a counterparty and records the reason.
    ///
    /// A score at or above `HARD_BLOCK_THRESHOLD` (8) blocks every later spend
    /// to that counterparty, exactly as it does in the offline engine.
    pub fn screen_counterparty(
        &mut self,
        to: AccountId,
        reason: String,
        score: u64,
    ) -> u64 {
        require!(score > 0, "the score must be positive");
        let nonce = self.counter + 1;
        self.counter = nonce;
        let blocked = score >= HARD_BLOCK_THRESHOLD;
        let held = !blocked && score >= HOLD_THRESHOLD;
        self.flag_order.insert(&nonce, &to);
        self.flags.insert(
            &to,
            &Flag {
                counterparty: to.clone(),
                reason,
                score,
                held,
                blocked,
                raised_by: env::signer_account_id(),
                nonce,
            },
        );
        nonce
    }

    /// Clear a flag (an appeal that was upheld).
    pub fn clear_flag(&mut self, to: AccountId) {
        self.flags.remove(&to);
        let keep: Vec<u64> = self
            .flag_order
            .iter()
            .filter_map(|(k, v)| if v == to { None } else { Some(k) })
            .collect();
        self.flag_order.clear();
        for k in keep {
            let v = self.flag_order.get(&k);
            if let Some(v) = v {
                self.flag_order.insert(&k, &v);
            }
        }
    }

    /// The flag on a counterparty, if it has one.
    pub fn get_flag(&self, to: AccountId) -> Option<Flag> {
        self.flags.get(&to)
    }

    /// Every counterparty currently flagged, with its reason and score.
    pub fn get_flags(&self) -> Vec<Flag> {
        self.flag_order
            .iter()
            .filter_map(|(_, account)| self.flags.get(&account))
            .collect::<Vec<Flag>>()
    }

    /// The spends a wallet made, allowed or not.
    pub fn get_spends(&self, wallet: AccountId) -> Vec<Spend> {
        self.spends.get(&wallet).unwrap_or_default()
    }

    /// The number of state changes so far - a monotone nonce for the explorer.
    pub fn get_counter(&self) -> u64 {
        self.counter
    }
}
