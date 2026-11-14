import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimJobRequest,
  DAiL_BASE,
  eventToDaiLRequest,
  getBountyRequest,
  listBountiesRequest,
  messageRequest,
  postJobRequest,
  submitWorkRequest,
} from '../src/dail-bridge.js';

test('a job maps onto a DAiL bounty post', () => {
  const req = postJobRequest({
    title: 'Market survey',
    description: 'Survey on-chain agent hiring',
    reward: 3_000_000,
    skill: 'research',
  });
  assert.equal(req.method, 'POST');
  assert.equal(req.path, '/world/bounties');
  assert.equal(req.body.reward, 3_000_000);
  assert.equal(req.body.skill, 'research');
  assert.ok(req.body.title.length <= 120);
  assert.ok(req.body.description.length <= 4000);
});

test('claim and submit respect the 5000-character submission cap', () => {
  const long = 'x'.repeat(9000);
  const claim = claimJobRequest({ bountyId: 'bnty_0413', agentId: 'atlas.near', submission: long });
  assert.equal(claim.path, '/world/bounties/bnty_0413/claim');
  assert.ok(claim.body.submission.length <= 5000);
  const submit = submitWorkRequest({ bountyId: 'bnty_0413', agentId: 'atlas.near', submission: long });
  assert.equal(submit.path, '/world/bounties/bnty_0413/submit');
  assert.ok(submit.body.submission.length <= 5000);
});

test('read requests are shaped correctly', () => {
  assert.equal(listBountiesRequest().path, '/world/bounties?limit=1000');
  assert.equal(listBountiesRequest().method, 'GET');
  assert.equal(getBountyRequest({ bountyId: 'bnty_0413' }).path, '/world/bounties/bnty_0413');
});

test('agent messages are capped at 2000 characters', () => {
  const req = messageRequest({ from: 'house.near', to: 'atlas.near', message: 'y'.repeat(5000) });
  assert.equal(req.path, '/runtime/messages');
  assert.ok(req.body.message.length <= 2000);
});

test('market events map onto DAiL requests', () => {
  const posted = eventToDaiLRequest({
    type: 'job_posted',
    job_id: 'job-alpha-1',
    label: 'Market survey on on-chain agent hiring',
    skill: 'research',
    budget: 3_000_000,
    min_reputation: 0,
  });
  assert.equal(posted.path, '/world/bounties');

  const awarded = eventToDaiLRequest({
    type: 'job_awarded',
    job_id: 'job-alpha-1',
    winner: 'atlas.near',
    price: 2_000_000,
    quality: 0.9,
    votes_for: 4,
    quorum: 4,
  });
  assert.equal(awarded.path, '/runtime/messages');
  assert.equal(awarded.body.to_id, 'atlas.near');

  const settled = eventToDaiLRequest({
    type: 'job_settled',
    job_id: 'job-alpha-1',
    winner: 'atlas.near',
    delivered_quality: 0.88,
    fee_to_social_money: 100_000,
  });
  assert.equal(settled.path, '/world/bounties/job-alpha-1/submit');
});

test('events with no DAiL counterpart map to null', () => {
  assert.equal(eventToDaiLRequest({ type: 'bid_placed' }), null);
  assert.equal(eventToDaiLRequest({ type: 'simulation_finished' }), null);
});

test('the base URL is the public DAiL API', () => {
  assert.equal(DAiL_BASE, 'https://dail-3dci.onrender.com');
});
