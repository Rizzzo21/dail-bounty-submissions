//! blind-escrow — a minimal CONFIDENTIAL job escrow for the NEAR Privacy entry.
//!
//! It is deliberately SMALL and it is deliberately HONEST. The point is that a reviewer can
//! read every line and recompute every claim:
//!
//!   1. `open_job(job_id, commitment, worker, ciphertext, iv)`
//!      — the buyer publishes ONLY the commitment
//!        C = SHA-256(amount_units || "|" || blinding_factor_hex || "|" || job_id)
//!        together with the encrypted payload and its IV.
//!      — NO amount is recorded anywhere. The escrow's own balance is the funding source, so
//!        the shielded amount is not written to the ledger until the job settles.
//!
//!   2. `settle(job_id, amount_units, blinding_factor_hex)`
//!      — anyone who knows the opening may settle. The contract RE-COMPUTES
//!        C' = SHA-256(amount_units || "|" || blinding_factor_hex || "|" || job_id)
//!        with the runtime's own SHA-256 and refuses unless C' == the stored commitment.
//!        A wrong blinding factor is a mismatching opening and is rejected.
//!      — on success the amount becomes public for the first time and the worker is paid
//!        `amount_units * UNIT_YOCTO` out of the pool (the "atomic reveal").
//!
//!   3. `sha256_hex(input)` — the cross-check tool: it hashes with the SAME runtime SHA-256 the
//!      contract uses, so the byte layout of the preimage can be verified against an off-chain
//!      `sha256sum` of the very same string. If the two disagree, the commitment is wrong.
//!
//! UNITS: one unit of the shielded amount = 0.001 NEAR (1e21 yoctoNEAR). The demo models a
//! 750-unit job; the live testnet settlement uses the same 750 units so that ONE recomputation
//! of the preimage validates both the off-chain demo and the on-chain commitment.
//!
//! NOT CLAIMED: NEAR transactions are public, so the *pool top-up* and the *payout* are visible.
//! What is NOT visible before settle is WHICH job a given deposit belongs to and WHAT the
//! shielded amount is. See the entry README for the full disclosure.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::Base64VecU8;
use near_sdk::{env, near_bindgen, require, AccountId, NearToken, Promise};
use serde::{Deserialize, Serialize};

/// One unit of the shielded amount = 0.001 NEAR.
pub const UNIT_YOCTO: u128 = 1_000_000_000_000_000_000_000;
/// Hard cap on a single settlement, so a bogus opening can never drain the pool.
pub const MAX_UNITS: u128 = 1_000_000;

#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize, PartialEq)]
pub struct Job {
    /// C — SHA-256 of the opening preimage. 32 bytes.
    pub commitment: Vec<u8>,
    /// Who gets paid when the job settles.
    pub worker: AccountId,
    /// The encrypted job payload (the plaintext never touches the chain).
    pub ciphertext: Vec<u8>,
    /// The AES-GCM IV used for the payload.
    pub iv: Vec<u8>,
    /// Has the opening been revealed and the job settled?
    pub opened: bool,
    /// The shielded amount, revealed at settle (0 before that).
    pub opened_amount_units: u128,
    /// The blinding factor, revealed at settle ("" before that).
    pub opened_blinding_hex: String,
    /// Monotonic counter, so the explorer shows a distinct transaction per step.
    pub nonce: u64,
}

/// A view type: hex/base64 strings so a human (or the demo) can read it directly.
#[derive(Serialize, Deserialize)]
pub struct JobView {
    pub job_id: String,
    pub commitment_hex: String,
    pub worker: AccountId,
    pub ciphertext_b64: String,
    pub iv_b64: String,
    pub opened: bool,
    pub opened_amount_units: u128,
    pub opened_blinding_hex: String,
    pub nonce: u64,
    pub pool_balance_yocto: u128,
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn b64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(T[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(T[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[derive(BorshDeserialize, BorshSerialize)]
#[near_bindgen]
pub struct BlindEscrow {
    jobs: LookupMap<String, Job>,
    counter: u64,
}

impl Default for BlindEscrow {
    fn default() -> Self {
        Self {
            jobs: LookupMap::new(b"j"),
            counter: 0,
        }
    }
}

/// The commitment preimage, byte for byte:
///   amount_units (decimal string) || "|" || blinding_factor_hex || "|" || job_id
fn preimage(amount_units: &str, blinding_hex: &str, job_id: &str) -> String {
    format!("{}|{}|{}", amount_units, blinding_hex, job_id)
}

#[near_bindgen]
impl BlindEscrow {
    /// Open a confidential job. Only the commitment, the ciphertext and the IV are published.
    /// The shielded amount is NOT part of this call and is not stored.
    pub fn open_job(
        &mut self,
        job_id: String,
        commitment: Base64VecU8,
        worker: AccountId,
        ciphertext: Base64VecU8,
        iv: Base64VecU8,
    ) -> u64 {
        require!(job_id.len() > 0 && job_id.len() <= 64, "bad job_id");
        require!(commitment.0.len() == 32, "commitment must be 32 bytes (sha256)");
        require!(self.jobs.get(&job_id).is_none(), "job already exists");
        let nonce = self.counter + 1;
        self.counter = nonce;
        let job = Job {
            commitment: commitment.0,
            worker,
            ciphertext: ciphertext.0,
            iv: iv.0,
            opened: false,
            opened_amount_units: 0,
            opened_blinding_hex: String::new(),
            nonce,
        };
        self.jobs.insert(&job_id, &job);
        nonce
    }

    /// Settle by revealing the opening. The commitment is re-computed on-chain and must match.
    /// A wrong blinding factor (or any other mismatching opening) is refused.
    pub fn settle(
        &mut self,
        job_id: String,
        amount_units: String,
        blinding_factor_hex: String,
    ) -> u64 {
        let mut job = self.jobs.get(&job_id).expect("no such job");
        require!(!job.opened, "job already settled");
        require!(
            blinding_factor_hex.len() == 64,
            "blinding factor must be 32 bytes of hex (64 chars)"
        );
        require!(
            blinding_factor_hex
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
            "blinding factor must be lowercase hex"
        );
        let units: u128 = amount_units
            .parse()
            .unwrap_or_else(|_| env::panic_str("amount_units must be a decimal integer"));
        require!(units > 0, "amount_units must be positive");
        require!(units <= MAX_UNITS, "amount_units above the cap");

        let recomputed = env::sha256(preimage(&amount_units, &blinding_factor_hex, &job_id).as_bytes());
        require!(
            recomputed == job.commitment,
            "opening rejected: recomputed commitment does not match"
        );

        let payout = units
            .checked_mul(UNIT_YOCTO)
            .unwrap_or_else(|| env::panic_str("amount overflow"));
        require!(
            env::account_balance().as_yoctonear() >= payout,
            "escrow pool is too small for this settlement"
        );

        job.opened = true;
        job.opened_amount_units = units;
        job.opened_blinding_hex = blinding_factor_hex;
        let nonce = self.counter + 1;
        self.counter = nonce;
        job.nonce = nonce;
        self.jobs.insert(&job_id, &job);

        let worker = job.worker.clone();
        Promise::new(worker).transfer(NearToken::from_yoctonear(payout));
        nonce
    }

    /// Read-only view of one job.
    pub fn view_job(&self, job_id: String) -> Option<JobView> {
        self.jobs.get(&job_id).map(|j| JobView {
            job_id,
            commitment_hex: hex_encode(&j.commitment),
            worker: j.worker,
            ciphertext_b64: b64_encode(&j.ciphertext),
            iv_b64: b64_encode(&j.iv),
            opened: j.opened,
            opened_amount_units: j.opened_amount_units,
            opened_blinding_hex: j.opened_blinding_hex,
            nonce: j.nonce,
            pool_balance_yocto: env::account_balance().as_yoctonear(),
        })
    }

    /// The cross-check tool: SHA-256 (the runtime's own) of the UTF-8 bytes of `input`, hex.
    /// Run this on the exact preimage string and compare it with `sha256sum` of the same bytes.
    pub fn sha256_hex(&self, input: String) -> String {
        hex_encode(&env::sha256(input.as_bytes()))
    }

    /// The escrow's own pool balance, in yoctoNEAR.
    pub fn pool_balance(&self) -> u128 {
        env::account_balance().as_yoctonear()
    }

    /// The monotonic step counter.
    pub fn get_counter(&self) -> u64 {
        self.counter
    }
}
