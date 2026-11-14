//! orbit-passport — a minimal NEAR contract for the DAiL Open PASSPORT entry.
//!
//! It mirrors the semantics the PASSPORT entry already implements offline, so
//! the deployed contract is not a different product:
//!
//!   1. `register(agent_id, composite, community)` — an issuer records a
//!      passport for an agent. The COMPOSITE score is stored and PUBLISHED
//!      (it is "a number for humans"), but it is never consulted by the gate.
//!   2. `open_escrow(agent_id, amount)` — opens an escrow against an agent's
//!      passport. The GATE reads the COMMUNITY score only. If the community
//!      score is below the threshold the escrow is REFUSED and no escrow is
//!      created. The composite score is NOT read on this path.
//!   3. `get_passport(agent_id)` — a passport lookup.
//!   4. `get_escrow_history(agent_id)` — the escrow-history read.
//!
//! The point of the deployment is that the house can read a REAL testnet
//! contract whose behaviour matches the entry's documented behaviour, including
//! the refusal case, and cite transaction hashes that resolve live.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{env, near_bindgen, require, AccountId, NearToken, Promise};
use near_sdk::collections::{LookupMap, UnorderedMap};
use serde::{Deserialize, Serialize};

/// The community-score threshold. Mirrors the entry's documented gate.
pub const COMMUNITY_THRESHOLD: f64 = 50.0;

#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize, PartialEq)]
pub struct Passport {
    pub agent_id: String,
    /// Published, for humans. NEVER consulted by the gate.
    pub composite: f64,
    /// The ONLY score the gate reads.
    pub community: f64,
    pub attestations: u32,
    pub issuer: AccountId,
    pub nonce: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize, PartialEq)]
pub struct Escrow {
    pub agent_id: String,
    pub amount: u128,
    pub opened_by: AccountId,
    pub released: bool,
    pub nonce: u64,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[near_bindgen]
pub struct OrbitPassport {
    passports: LookupMap<String, Passport>,
    escrows: UnorderedMap<u64, Escrow>,
    /// agent_id -> list of escrow nonces, so the history read is by agent.
    history: LookupMap<String, Vec<u64>>,
    counter: u64,
}

impl Default for OrbitPassport {
    fn default() -> Self {
        Self {
            passports: LookupMap::new(b"p"),
            escrows: UnorderedMap::new(b"e"),
            history: LookupMap::new(b"h"),
            counter: 0,
        }
    }
}

#[near_bindgen]
impl OrbitPassport {
    /// Record a passport for `agent_id`.
    pub fn register(&mut self, agent_id: String, composite: f64, community: f64) -> u64 {
        require!(!agent_id.is_empty(), "agent_id must not be empty");
        require!(
            !self.passports.get(&agent_id).is_some(),
            "passport already registered"
        );
        let nonce = self.counter + 1;
        self.counter = nonce;
        let p = Passport {
            agent_id: agent_id.clone(),
            composite,
            community,
            attestations: 1,
            issuer: env::signer_account_id(),
            nonce,
        };
        self.passports.insert(&agent_id, &p);
        nonce
    }

    /// Open an escrow against `agent_id`'s passport.
    ///
    /// THE GATE READS `community` ONLY. The composite score is deliberately
    /// not consulted, which is exactly the behaviour the entry claims and the
    /// check the entry's own verifier enforces ("a gate never reads the
    /// composite score", checked behaviourally).
    #[payable]
    pub fn open_escrow(&mut self, agent_id: String) -> u64 {
        let p = self.passports.get(&agent_id).unwrap_or_else(|| {
            env::panic_str("no passport for that agent")
        });
        require!(
            p.community >= COMMUNITY_THRESHOLD,
            "REFUSED: community score below the threshold"
        );
        let nonce = self.counter + 1;
        self.counter = nonce;
        let e = Escrow {
            agent_id: agent_id.clone(),
            amount: env::attached_deposit().as_yoctonear(),
            opened_by: env::signer_account_id(),
            released: false,
            nonce,
        };
        self.escrows.insert(&nonce, &e);
        let mut hs = self.history.get(&agent_id).unwrap_or_default();
        hs.push(nonce);
        self.history.insert(&agent_id, &hs);
        nonce
    }

    /// Release an escrow back to whoever opened it.
    pub fn release(&mut self, nonce: u64) {
        let mut e = self
            .escrows
            .get(&nonce)
            .unwrap_or_else(|| env::panic_str("no such escrow"));
        require!(!e.released, "escrow already released");
        e.released = true;
        self.escrows.insert(&nonce, &e);
        let amount = e.amount;
        let to = e.opened_by.clone();
        Promise::new(to).transfer(NearToken::from_yoctonear(amount));
    }

    /// A passport lookup.
    pub fn get_passport(&self, agent_id: String) -> Option<Passport> {
        self.passports.get(&agent_id)
    }

    /// The escrow-history read.
    pub fn get_escrow_history(&self, agent_id: String) -> Vec<Escrow> {
        let hs = self.history.get(&agent_id).unwrap_or_default();
        hs.iter()
            .filter_map(|n| self.escrows.get(n))
            .collect()
    }

    /// The gate threshold, so a reader can check the gate's rule directly.
    pub fn get_threshold(&self) -> f64 {
        COMMUNITY_THRESHOLD
    }

    pub fn get_counter(&self) -> u64 {
        self.counter
    }
}
