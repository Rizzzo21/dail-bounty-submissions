//! orbit-ritual — a minimal on-chain memecoin ritual for the DAiL RITUAL entry.
//!
//! It implements the three mechanics of the token in `src/`, with the same
//! numbers, so that the bounty's "a real CHANT/BURN/HOWL ritual triggering a
//! treasury rule on testnet" is a genuine on-chain event:
//!
//!   * CHANT - the signers pay a chant fee into the treasury and the ritual
//!     mints, with the steward's disclosed cut going to the treasury
//!   * BURN  - the signers burn their tokens
//!   * HOWL  - a window opens; while it is open the pool fees carry an extra
//!     howl tax that is burned
//!
//! and the two treasury rules, always in this order:
//!
//!   R1 liquidity floor - the treasury mints itself tokens up to the floor
//!   R2 buyback         - above the USDC ceiling it buys tokens with the fees
//!                        it collected and burns them
//!
//! Every tunable is the offline engine's own default (src/state.js), not a
//! number invented for the contract:
//!
//!   quorumVotes 3   minStake 1000   chantFee 100    burnPerSigner 5000
//!   mintCap 500000  stewardBps 200  feeBurnBps 3000 treasuryFloor 10000
//!   treasuryCeiling 10000           poolFeeBps 300 howlTaxBps 100
//!   pool: 2000000 tokens against 800000 USDC
//!
//! Flow:
//!   1. `seed(holders, amount)`             - the demo supply (the owner only)
//!   2. `open_ritual("CHANT")`              - a ritual needs three votes
//!   3. `sign_ritual(id)` x3                - each signer needs minStake tokens;
//!      the third vote fires the ritual and runs the treasury rules
//!   4. `swap("y_to_x", amount)`            - the fee goes to the treasury and
//!      the howl tax is burned while a howl window is open

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::{env, near_bindgen, require, AccountId};
use serde::{Deserialize, Serialize};

pub const QUORUM_VOTES: u64 = 3;
pub const MIN_STAKE: u128 = 1000;
pub const CHANT_FEE: u128 = 100;
pub const BURN_PER_SIGNER: u128 = 5000;
pub const MINT_CAP: u128 = 500_000;
pub const STEWARD_BPS: u128 = 200;
pub const TREASURY_FLOOR: u128 = 10000;
pub const TREASURY_CEILING: u128 = 10000;
pub const POOL_FEE_BPS: u128 = 300;
pub const HOWL_TAX_BPS: u128 = 100;
pub const POOL_X: u128 = 2_000_000;
pub const POOL_Y: u128 = 800_000;

#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize, PartialEq)]
pub struct Ritual {
    pub id: u64,
    pub kind: String,
    pub votes: Vec<AccountId>,
    pub fired: bool,
    pub minted: u128,
    pub burned: u128,
    pub fees: u128,
    pub howl_until_epoch: u64,
    pub nonce: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize, PartialEq)]
pub struct State {
    pub pool_x: u128,
    pub pool_y: u128,
    pub supply: u128,
    pub treasury_tokens: u128,
    pub treasury_usdc: u128,
    pub burned: u128,
    pub epoch: u64,
    pub howl_until_epoch: u64,
    pub counter: u64,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[near_bindgen]
pub struct OrbitRitual {
    pool_x: u128,
    pool_y: u128,
    supply: u128,
    treasury_tokens: u128,
    treasury_usdc: u128,
    burned: u128,
    epoch: u64,
    howl_until_epoch: u64,
    counter: u64,
    owner: Option<AccountId>,
    balances: LookupMap<AccountId, u128>,
    rituals: LookupMap<u64, Ritual>,
}

impl Default for OrbitRitual {
    fn default() -> Self {
        Self {
            pool_x: POOL_X,
            pool_y: POOL_Y,
            supply: POOL_X,
            treasury_tokens: 0,
            treasury_usdc: 0,
            burned: 0,
            epoch: 1,
            howl_until_epoch: 0,
            counter: 0,
            owner: None,
            balances: LookupMap::new(b"b"),
            rituals: LookupMap::new(b"r"),
        }
    }
}

#[near_bindgen]
impl OrbitRitual {
    /// The demo supply: mint `amount` tokens to each holder. The owner (the
    /// account that seeds it) is the only one who may call this.
    pub fn seed(&mut self, holders: Vec<AccountId>, amount: u128) -> u64 {
        let signer = env::signer_account_id();
        match self.owner.clone() {
            Some(owner) => require!(owner == signer, "only the owner may seed the supply"),
            None => {
                self.owner = Some(signer);
            }
        }
        require!(amount > 0, "the amount must be positive");
        for holder in holders.iter() {
            let balance = self.balances.get(holder).unwrap_or(0);
            self.balances.insert(holder, &(balance + amount));
            self.supply += amount;
        }
        self.counter += 1;
        self.counter
    }

    /// The token balance of an account.
    pub fn balance_of(&self, account: AccountId) -> u128 {
        self.balances.get(&account).unwrap_or(0)
    }

    /// Open a ritual of kind CHANT, BURN or HOWL.
    pub fn open_ritual(&mut self, kind: String) -> u64 {
        require!(
            kind == "CHANT" || kind == "BURN" || kind == "HOWL",
            "the ritual kind must be CHANT, BURN or HOWL"
        );
        let id = self.counter + 1;
        self.counter = id;
        self.rituals.insert(
            &id,
            &Ritual {
                id,
                kind,
                votes: Vec::new(),
                fired: false,
                minted: 0,
                burned: 0,
                fees: 0,
                howl_until_epoch: 0,
                nonce: id,
            },
        );
        id
    }

    /// Sign a ritual. A signer must hold at least `minStake` tokens (the
    /// anti-Sybil rule). When the votes reach the quorum the ritual fires and
    /// the two treasury rules run.
    pub fn sign_ritual(&mut self, ritual_id: u64) -> Ritual {
        let signer = env::signer_account_id();
        let mut ritual = self
            .rituals
            .get(&ritual_id)
            .unwrap_or_else(|| panic!("no such ritual"));
        require!(!ritual.fired, "the ritual has already fired");
        require!(
            !ritual.votes.contains(&signer),
            "this account has already signed the ritual"
        );
        let balance = self.balances.get(&signer).unwrap_or(0);
        require!(
            balance >= MIN_STAKE,
            "the signer holds fewer than minStake tokens"
        );
        ritual.votes.push(signer.clone());
        if ritual.votes.len() as u64 >= QUORUM_VOTES {
            self.fire(&mut ritual);
        }
        self.rituals.insert(&ritual_id, &ritual);
        ritual
    }

    /// A ritual, by id.
    pub fn get_ritual(&self, ritual_id: u64) -> Option<Ritual> {
        self.rituals.get(&ritual_id)
    }

    /// The whole public state.
    pub fn get_state(&self) -> State {
        State {
            pool_x: self.pool_x,
            pool_y: self.pool_y,
            supply: self.supply,
            treasury_tokens: self.treasury_tokens,
            treasury_usdc: self.treasury_usdc,
            burned: self.burned,
            epoch: self.epoch,
            howl_until_epoch: self.howl_until_epoch,
            counter: self.counter,
        }
    }

    /// Swap against the pool.
    ///
    /// `direction` is "y_to_x" (USDC in, tokens out) or "x_to_y" (tokens in,
    /// USDC out). The fee always goes to the treasury and the howl tax is
    /// always burned - and the howl tax is charged only while a howl window
    /// is open, exactly as in src/mechanics.js.
    pub fn swap(&mut self, direction: String, amount_in: u128) -> State {
        require!(amount_in > 0, "the amount must be positive");
        let howl_open = self.epoch <= self.howl_until_epoch;
        if direction == "y_to_x" {
            let fee = (amount_in * POOL_FEE_BPS) / 10000;
            let net_in = amount_in - fee;
            let out = (self.pool_y * net_in) / (self.pool_x + net_in);
            let howl_tax = if howl_open {
                (out * HOWL_TAX_BPS) / 10000
            } else {
                0
            };
            self.pool_y += net_in;
            self.pool_x -= out;
            self.treasury_usdc += fee;
            self.burned += howl_tax;
            self.supply -= howl_tax;
        } else {
            require!(direction == "x_to_y", "the direction must be y_to_x or x_to_y");
            let howl_tax = if howl_open {
                (amount_in * HOWL_TAX_BPS) / 10000
            } else {
                0
            };
            let net_in = amount_in - howl_tax;
            let out = (self.pool_x * net_in) / (self.pool_y + net_in);
            let fee = (out * POOL_FEE_BPS) / 10000;
            self.pool_x += net_in;
            self.pool_y -= out;
            self.treasury_usdc += fee;
            self.burned += howl_tax;
            self.supply -= howl_tax;
        }
        self.counter += 1;
        self.get_state()
    }

    /// Fire a ritual and run the treasury rules. Kept private on purpose: the
    /// only way to fire a ritual is to earn the quorum.
    fn fire(&mut self, ritual: &mut Ritual) {
        let signers = ritual.votes.clone();
        match ritual.kind.as_str() {
            "CHANT" => {
                // every signer pays the chant fee into the treasury
                for signer in signers.iter() {
                    let balance = self.balances.get(signer).unwrap_or(0);
                    self.balances.insert(signer, &(balance - CHANT_FEE));
                    self.treasury_tokens += CHANT_FEE;
                    ritual.fees += CHANT_FEE;
                }
                // the mint, capped, with the steward's disclosed cut
                let minted = (MINT_CAP * signers.len() as u128) / (QUORUM_VOTES as u128);
                let steward_cut = (minted * STEWARD_BPS) / 10000;
                let to_signers = minted - steward_cut;
                let each = to_signers / signers.len() as u128;
                for signer in signers.iter() {
                    let balance = self.balances.get(signer).unwrap_or(0);
                    self.balances.insert(signer, &(balance + each));
                }
                self.supply += minted;
                self.treasury_tokens += steward_cut;
                ritual.minted = minted;
            }
            "BURN" => {
                for signer in signers.iter() {
                    let balance = self.balances.get(signer).unwrap_or(0);
                    self.balances.insert(signer, &(balance - BURN_PER_SIGNER));
                    self.supply -= BURN_PER_SIGNER;
                    self.burned += BURN_PER_SIGNER;
                    ritual.burned += BURN_PER_SIGNER;
                }
            }
            "HOWL" => {
                self.howl_until_epoch = self.epoch + 1;
                ritual.howl_until_epoch = self.howl_until_epoch;
            }
            _ => panic!("unknown ritual kind"),
        }
        ritual.fired = true;
        self.epoch += 1;
        self.treasury_rules(ritual);
        self.counter += 1;
    }

    /// The two treasury rules, always in this order.
    fn treasury_rules(&mut self, ritual: &mut Ritual) {
        // R1 liquidity floor - the treasury mints itself tokens up to the floor
        if self.treasury_tokens < TREASURY_FLOOR {
            let minted = TREASURY_FLOOR - self.treasury_tokens;
            self.treasury_tokens += minted;
            self.supply += minted;
        }
        // R2 buyback - above the USDC ceiling it buys tokens with the fees it
        // collected and burns them
        if self.treasury_usdc >= TREASURY_CEILING && self.pool_y > 0 {
            let spent = self.treasury_usdc;
            let bought = (spent * self.pool_x) / self.pool_y;
            self.treasury_usdc = 0;
            self.treasury_tokens += bought;
            self.burned += bought;
            self.supply -= bought;
            ritual.burned += bought;
        }
    }
}
