// The compliance gate. A position can only move between parties that are both
// cleared to hold it, and nobody can move a frozen position at all.
//
// The rules are data, so a reviewer can read the whole gate in one file.
export const STATUS = {
  UNVERIFIED: 'UNVERIFIED',
  VERIFIED: 'VERIFIED',
  BLOCKED: 'BLOCKED',
};

export const JURISDICTIONS = ['TW', 'US', 'SG', 'DE', 'BR'];

// Which jurisdictions each asset may be held in.
export const ASSET_JURISDICTIONS = {
  't-bill-2026q4': ['TW', 'US', 'SG'],
  'warehouse-nyc': ['US'],
};

// Can this address hold this asset?
export function canHold(state, address, assetId) {
  const party = state.parties[address];
  if (!party) return { ok: false, reason: `${address} is not registered with the registry` };
  if (party.status === STATUS.BLOCKED) return { ok: false, reason: `${address} is blocked` };
  if (party.status !== STATUS.VERIFIED) {
    return { ok: false, reason: `${address} is ${party.status} - a cleared address is required` };
  }
  const allowed = ASSET_JURISDICTIONS[assetId] || JURISDICTIONS;
  if (!allowed.includes(party.jurisdiction)) {
    return { ok: false, reason: `${address} (${party.jurisdiction}) may not hold ${assetId} (${allowed.join('/')})` };
  }
  if (state.frozen[address]) return { ok: false, reason: `${address} is frozen` };
  return { ok: true };
}
