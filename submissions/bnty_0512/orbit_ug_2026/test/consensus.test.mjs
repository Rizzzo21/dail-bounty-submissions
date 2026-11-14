import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsensusRound, quorumSize, proposalDigest } from '../src/consensus.js';
import { keypairFromSeed, sha256, signWith } from '../src/util.js';

function makeValidators(n) {
  const keys = new Map();
  for (let i = 0; i < n; i += 1) {
    const id = `v${i}.near`;
    keys.set(id, keypairFromSeed(sha256(`validator-${i}`)));
  }
  return {
    ids: [...keys.keys()].sort(),
    publicKeyOf: (id) => keys.get(id).pubRaw,
    sign: (id, digest) => signWith(keys.get(id).priv, digest),
  };
}

test('quorum is a strict supermajority', () => {
  assert.equal(quorumSize(3), 3);
  assert.equal(quorumSize(4), 3);
  assert.equal(quorumSize(5), 4);
  assert.equal(quorumSize(6), 5);
});

test('a supermajority of matching votes commits the digest', () => {
  const v = makeValidators(5);
  const round = new ConsensusRound({ validators: v.ids });
  const digest = proposalDigest({ job: 'j', winner: 'a' });
  for (const id of v.ids.slice(0, 4)) {
    const res = round.cast({ agent_id: id, digest, signature: v.sign(id, digest) }, v.publicKeyOf);
    assert.equal(res.ok, true);
  }
  const tally = round.tally();
  assert.equal(tally.committed, true);
  assert.equal(tally.digest, digest);
  assert.equal(tally.votes_for, 4);
  assert.equal(tally.quorum, 4);
});

test('a minority does not commit', () => {
  const v = makeValidators(5);
  const round = new ConsensusRound({ validators: v.ids });
  const digest = proposalDigest({ job: 'j' });
  for (const id of v.ids.slice(0, 3)) {
    round.cast({ agent_id: id, digest, signature: v.sign(id, digest) }, v.publicKeyOf);
  }
  const tally = round.tally();
  assert.equal(tally.committed, false);
  assert.equal(tally.votes_for, 3);
});

test('split votes do not commit', () => {
  const v = makeValidators(5);
  const round = new ConsensusRound({ validators: v.ids });
  const a = proposalDigest({ job: 'j', winner: 'a' });
  const b = proposalDigest({ job: 'j', winner: 'b' });
  round.cast({ agent_id: v.ids[0], digest: a, signature: v.sign(v.ids[0], a) }, v.publicKeyOf);
  round.cast({ agent_id: v.ids[1], digest: b, signature: v.sign(v.ids[1], b) }, v.publicKeyOf);
  round.cast({ agent_id: v.ids[2], digest: a, signature: v.sign(v.ids[2], a) }, v.publicKeyOf);
  const tally = round.tally();
  assert.equal(tally.committed, false);
  assert.equal(tally.votes_for, 2);
});

test('a forged signature is rejected', () => {
  const v = makeValidators(5);
  const round = new ConsensusRound({ validators: v.ids });
  const digest = proposalDigest({ job: 'j' });
  const other = keypairFromSeed(sha256('attacker'));
  const res = round.cast(
    { agent_id: v.ids[0], digest, signature: signWith(other.priv, digest) },
    v.publicKeyOf,
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /invalid signature/);
});

test('a validator cannot vote twice', () => {
  const v = makeValidators(5);
  const round = new ConsensusRound({ validators: v.ids });
  const digest = proposalDigest({ job: 'j' });
  assert.equal(round.cast({ agent_id: v.ids[0], digest, signature: v.sign(v.ids[0], digest) }, v.publicKeyOf).ok, true);
  const again = round.cast({ agent_id: v.ids[0], digest, signature: v.sign(v.ids[0], digest) }, v.publicKeyOf);
  assert.equal(again.ok, false);
  assert.match(again.error, /already voted/);
});

test('a non-validator cannot vote', () => {
  const v = makeValidators(5);
  const round = new ConsensusRound({ validators: v.ids });
  const digest = proposalDigest({ job: 'j' });
  const res = round.cast({ agent_id: 'stranger.near', digest, signature: '00' }, v.publicKeyOf);
  assert.equal(res.ok, false);
});

test('a vote from another round is rejected', () => {
  const v = makeValidators(5);
  const round = new ConsensusRound({ validators: v.ids, round: 2 });
  const digest = proposalDigest({ job: 'j' });
  const res = round.cast(
    { agent_id: v.ids[0], digest, signature: v.sign(v.ids[0], digest), round: 1 },
    v.publicKeyOf,
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /round mismatch/);
});

test('a failed round escalates to the next round', () => {
  const v = makeValidators(5);
  const round = new ConsensusRound({ validators: v.ids, round: 1 });
  const next = round.escalate({ job: 'j' });
  assert.equal(next.round, 2);
  assert.equal(next.previous, round);
});
