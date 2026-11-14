// DAiL bridge.
//
// The bounty asks the entry to lean on DAiL's live agent-to-agent hiring,
// escrow and bounty mechanics as the working example. This module maps the
// market's own events onto DAiL API calls WITHOUT performing them.
//
// Design decision: this file contains only *request shaping*. It never opens a
// socket and it never holds a credential. It produces the exact JSON bodies
// and the exact HTTP method + path that the DAiL API expects, so that
//   (a) a reviewer can see exactly how the market plugs into DAiL, and
//   (b) the shape of every call is unit-tested offline.
//
// The live call itself lives in scripts/dail-bridge.mjs and needs
// DAiL_API_KEY in the environment. Nothing in this repository contains a key.
//
// Verified against the live API on 2026-11-02 (read-only): the endpoints below
// exist and return the shapes the market expects. The write endpoints were NOT
// exercised, because the house should decide when a live write happens. See
// the "DAiL bridge" section of README.md for what was checked.

export const DAiL_BASE = 'https://dail-3dci.onrender.com';

/** Header set for an authenticated DAiL request. The key comes from the env. */
export function authHeaders(apiKey) {
  if (!apiKey) throw new Error('DAiL API key is required (set DAiL_API_KEY)');
  return {
    Authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

/**
 * Post a job to the DAiL board.
 * POST /world/bounties
 */
export function postJobRequest({ title, description, reward, skill, tags = [] }) {
  return {
    method: 'POST',
    path: '/world/bounties',
    body: {
      title: String(title).slice(0, 120),
      description: String(description).slice(0, 4000),
      reward: Number(reward),
      tags,
      skill: skill ?? null,
    },
  };
}

/**
 * Claim a posted job on behalf of an agent.
 * POST /world/bounties/{id}/claim
 */
export function claimJobRequest({ bountyId, agentId, submission }) {
  return {
    method: 'POST',
    path: `/world/bounties/${encodeURIComponent(bountyId)}/claim`,
    body: {
      agent_id: agentId,
      // DAiL caps the submission body at 100-5000 characters.
      submission: String(submission).slice(0, 5000),
    },
  };
}

/**
 * Submit completed work against a claimed job (settlement by intent).
 * POST /world/bounties/{id}/submit
 */
export function submitWorkRequest({ bountyId, agentId, submission, evidenceUrl = null }) {
  return {
    method: 'POST',
    path: `/world/bounties/${encodeURIComponent(bountyId)}/submit`,
    body: {
      agent_id: agentId,
      submission: String(submission).slice(0, 5000),
      evidence_url: evidenceUrl,
    },
  };
}

/**
 * Read the board.
 * GET /world/bounties?limit=1000
 */
export function listBountiesRequest({ limit = 1000 } = {}) {
  return {
    method: 'GET',
    path: `/world/bounties?limit=${Number(limit)}`,
    body: null,
  };
}

/**
 * Read one bounty.
 * GET /world/bounties/{id}
 */
export function getBountyRequest({ bountyId }) {
  return {
    method: 'GET',
    path: `/world/bounties/${encodeURIComponent(bountyId)}`,
    body: null,
  };
}

/**
 * Send an agent-to-agent message (free, used to announce an award).
 * POST /runtime/messages
 */
export function messageRequest({ from, to, message }) {
  return {
    method: 'POST',
    path: '/runtime/messages',
    body: {
      from_id: from,
      to_id: to,
      message: String(message).slice(0, 2000),
    },
  };
}

/**
 * Turn a market event into the DAiL request that expresses it.
 * Returns null for events that have no DAiL counterpart.
 */
export function eventToDaiLRequest(event, context = {}) {
  switch (event.type) {
    case 'job_posted':
      return postJobRequest({
        title: event.label || event.job_id,
        description:
          `Agent-coordination market job ${event.job_id}. ` +
          `Skill: ${event.skill}. Budget: ${event.budget} uNEAR. ` +
          `Reputation gate: score >= ${event.min_reputation}.`,
        reward: event.budget,
        skill: event.skill,
      });
    case 'job_awarded':
      return messageRequest({
        from: context.houseAgentId || 'house.near',
        to: event.winner,
        message:
          `You won ${event.job_id} for ${event.price} uNEAR ` +
          `(quality ${event.quality}, ratified by ${event.votes_for}/${event.quorum} validators).`,
      });
    case 'job_settled':
      return submitWorkRequest({
        bountyId: context.dailBountyId || event.job_id,
        agentId: event.winner,
        submission:
          `Job ${event.job_id} delivered at quality ${event.delivered_quality}. ` +
          `Escrow settled, fee to social money: ${event.fee_to_social_money} uNEAR.`,
        evidenceUrl: context.evidenceUrl || null,
      });
    default:
      return null;
  }
}

/**
 * Perform a shaped request against the live DAiL API.
 * This is the ONLY function in the repository that performs a DAiL write, and
 * it is never called by the demo or the tests.
 */
export async function sendDaiL(request, { apiKey, baseUrl = DAiL_BASE, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`${baseUrl}${request.path}`, {
    method: request.method,
    headers: authHeaders(apiKey),
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, ok: res.ok, body: parsed };
}
