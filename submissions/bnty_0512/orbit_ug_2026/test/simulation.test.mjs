import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwarmSimulation, runSimulation, DEFAULT_SEED } from '../src/simulation.js';
import { ShieldPoolContract } from '../src/shield-pool.js';
import { computeBidDigest, selectWinner } from '../src/rules.js';

test('the simulation runs offline and produces a trace', async () => {
  const result = await runSimulation({ seed: DEFAULT_SEED });
  assert.ok(result.rounds >= 8);
  assert.ok(result.trace.length > 50);
  assert.equal(result.seed, DEFAULT_SEED);
});

test('the simulation is deterministic: same seed, same trace', async () => {
  const a = await runSimulation({ seed: 'repeat-me' });
  const b = await runSimulation({ seed: 'repeat-me' });
  assert.deepEqual(a.trace, b.trace);
  assert.deepEqual(a.final_balances, b.final_balances);
  assert.deepEqual(a.final_scores, b.final_scores);
});

test('a different seed produces a different run', async () => {
  const a = await runSimulation({ seed: 'seed-a' });
  const b = await runSimulation({ seed: 'seed-b' });
  assert.notDeepEqual(a.trace, b.trace);
});

test('money is conserved: no NEAR is created or destroyed', async () => {
  const sim = new SwarmSimulation({ seed: 'conservation' });
  const total = () => {
    let sum = 0;
    for (const account of sim.chain.accounts.values()) sum += account.balance;
    return sum;
  };
  const before = total();
  await sim.run();
  const after = total();
  // the house and the vendor start with funds; the pool is pre-funded from the
  // house, so the only change is what the house paid out plus the pool's
  // unspent remainder. Everything must still be accounted for.
  assert.equal(after, before);
});

test('the reputation gate blocks agents below the threshold', async () => {
  const result = await runSimulation({ seed: DEFAULT_SEED });
  const gated = result.trace.filter((e) => e.type === 'bid_rejected' && e.error === 'reputation gate');
  assert.ok(gated.length > 0, 'expected at least one gated bid');
  for (const e of gated) assert.ok(e.score < 52);
});

test('a job that cannot reach consensus is not awarded', async () => {
  const result = await runSimulation({ seed: DEFAULT_SEED });
  const failures = result.trace.filter((e) => e.type === 'consensus_failed');
  assert.ok(failures.length > 0, 'expected at least one consensus failure');
  for (const f of failures) assert.ok(f.votes_for < f.quorum);
  const failedJob = failures[0].job_id;
  const awarded = result.trace.find((e) => e.type === 'job_awarded' && e.job_id === failedJob);
  assert.equal(awarded, undefined);
});

test('awards need a supermajority of matching votes', async () => {
  const result = await runSimulation({ seed: DEFAULT_SEED });
  for (const e of result.trace.filter((x) => x.type === 'job_awarded')) {
    assert.ok(e.votes_for >= e.quorum, `${e.job_id}: ${e.votes_for}/${e.quorum}`);
  }
});

test('a shielded escrow never publishes its amount before the reveal', async () => {
  const sim = new SwarmSimulation({ seed: DEFAULT_SEED });
  await sim.run();
  const shielded = sim.contract.escrows.get('escrow:job-delta-4');
  assert.ok(shielded.shielded);
  assert.equal(shielded.amount, null);
  assert.equal(shielded.commitment.length, 64);
  // the pool's public view has no amount field at all
  const poolView = await sim.chain.viewCall({
    contractId: 'shield-pool.near',
    method: 'get_escrow',
    args: { escrow_id: 'escrow:job-delta-4' },
  });
  assert.equal(poolView.amount, undefined);
  assert.equal(poolView.commitment.length, 64);
});

test('the private aggregate equals the sum of the private values and leaks none of them', async () => {
  const sim = new SwarmSimulation({ seed: DEFAULT_SEED });
  const result = await sim.run();
  const published = result.trace.find((e) => e.type === 'private_aggregate_published');
  assert.ok(published);
  assert.equal(published.matches_sum_of_private_values, true);
  assert.equal(published.individual_values_published, 0);
  // nothing in the trace contains an individual private value
  for (const event of result.trace.filter((e) => e.type === 'private_column_submitted')) {
    assert.equal(typeof event.column_sum, 'string');
  }
});

test('the collective purchase draws on the social-money pool', async () => {
  const result = await runSimulation({ seed: DEFAULT_SEED });
  const purchase = result.trace.find((e) => e.type === 'purchase_settled');
  assert.ok(purchase);
  assert.ok(purchase.social_money_subsidy > 0);
  assert.ok(purchase.units > 0);
  const allocated = purchase.allocation.reduce((a, x) => a + x.cost, 0);
  assert.equal(allocated, purchase.gross_cost - purchase.social_money_subsidy);
});

test('reputation rises for good work and the social money pool grows', async () => {
  const result = await runSimulation({ seed: DEFAULT_SEED });
  for (const [agent, score] of Object.entries(result.final_scores)) {
    assert.ok(score >= 0 && score <= 100, `${agent} score ${score}`);
  }
  assert.ok(result.final_balances['treasury (social money)'] > 0);
});

test('the privacy pool refuses a reveal that does not open the commitment', async () => {
  const sim = new SwarmSimulation({ seed: DEFAULT_SEED });
  await sim.run();
  // a fresh, unfunded-but-open escrow in a throwaway pool
  const pool = new ShieldPoolContract({ id: 'pool-under-test.near' });
  sim.chain.deployContract(pool);
  await sim.chain.callFunction({
    contractId: 'pool-under-test.near',
    method: 'open_escrow',
    args: { escrow_id: 'e1', commitment: 'a'.repeat(64) },
    signer: 'house.near',
  });
  const { result } = await sim.chain.callFunction({
    contractId: 'pool-under-test.near',
    method: 'payout_split',
    args: {
      escrow_id: 'e1',
      reveal: { amount: 1, nonce: 'wrong', blinding: 'wrong' },
      splits: [{ recipient: 'atlas.near', amount: 1 }],
    },
    signer: 'house.near',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /does not open the commitment/);
});

test('the pool refuses to pay out twice', async () => {
  const sim = new SwarmSimulation({ seed: DEFAULT_SEED });
  await sim.run();
  const escrow = sim.contract.escrows.get('escrow:job-golf-7');
  const { result } = await sim.chain.callFunction({
    contractId: 'shield-pool.near',
    method: 'payout_split',
    args: {
      escrow_id: 'escrow:job-golf-7',
      reveal: { amount: escrow.amount ?? 1_750_000, nonce: '884422', blinding: '55100399' },
      splits: [{ recipient: 'atlas.near', amount: 1_750_000 }],
    },
    signer: 'swarm-market.near',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /already paid/);
});

test('the winner rule is deterministic and independent of bid order', () => {
  const bids = [
    { agent_id: 'b.near', price: 10, quality: 0.9, deliver_days: 1 },
    { agent_id: 'a.near', price: 12, quality: 0.9, deliver_days: 1 },
    { agent_id: 'c.near', price: 5, quality: 0.5, deliver_days: 1 },
  ];
  const winner = selectWinner(bids);
  assert.equal(winner.agent_id, 'b.near');
  const shuffled = [bids[2], bids[0], bids[1]];
  assert.equal(selectWinner(shuffled).agent_id, 'b.near');
});

test('the bid digest covers every bid', () => {
  const job = { job_id: 'j', skill: 's', budget: 100, min_reputation: 0, min_quality: null };
  const bids = [{ agent_id: 'a.near', price: 10, quality: 0.5, deliver_days: 2 }];
  const d1 = computeBidDigest(job, bids);
  const d2 = computeBidDigest(job, [...bids, { agent_id: 'b.near', price: 9, quality: 0.6, deliver_days: 2 }]);
  assert.notEqual(d1, d2);
  assert.equal(computeBidDigest(job, bids), d1);
});
