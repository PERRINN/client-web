const DAY = 86400000;
const millis = value => typeof value === 'number' ? value : value?.toMillis?.() || (Number(value?.seconds) * 1000 || 0);

// Legacy state has a fixed reference too: the time at which daysLeft was saved.
function storedFund(fund = {}, verifiedAt) {
  fund = fund || {};
  const reference = millis(verifiedAt);
  const legacyCancelled = fund.amountGBPTarget > 0 && fund.amountGBPTarget < 0.01;
  const closesAt = !(fund.amountGBPTarget > 0) ? null : Number.isSafeInteger(fund.closesAt) && fund.closesAt > 0 ? fund.closesAt
    : reference > 0 && Number.isFinite(fund.daysLeft) ? Math.round(reference + fund.daysLeft * DAY) : null;
  return { description: fund.description || 'add a description', amountGBPTarget: fund.amountGBPTarget || 0,
    amountGBPRaised: fund.amountGBPRaised || 0, closesAt, cancelled: fund.cancelled === true || legacyCancelled };
}

function resolveFund(previous, command, now, { verifiedAt, raised, reprocessing = false } = {}) {
  const base = storedFund(previous?.fund, previous?.verifiedTimestamp);
  const input = command || {};
  const next = reprocessing ? storedFund(input, verifiedAt) : { ...base,
    description: input.description || base.description,
    amountGBPTarget: input.amountGBPTarget || base.amountGBPTarget,
    amountGBPRaised: raised ?? base.amountGBPRaised };
  if (!reprocessing) {
    if (input.closesAt !== undefined) next.closesAt = input.closesAt;
    else if (input.daysLeft) next.closesAt = Math.round(now + input.daysLeft * DAY);
    if (typeof input.cancelled === 'boolean') next.cancelled = input.cancelled;
    // Old clients may still submit the legacy cancellation marker during rollout.
    if (input.amountGBPTarget > 0 && input.amountGBPTarget < 0.01 || input.daysLeft && input.daysLeft < 1) next.cancelled = true;
  }
  if (!(next.amountGBPTarget > 0)) next.closesAt = null;
  // Compatibility projections for older clients. Neither controls the new lifecycle.
  next.daysLeft = next.closesAt ? Math.round((next.closesAt - now) / DAY * 10) / 10 : 0;
  next.active = next.amountGBPTarget >= 0.01 && !next.cancelled && next.closesAt > now;
  next.amountGBPTargetUpdated = next.amountGBPTarget !== base.amountGBPTarget;
  return next;
}
module.exports = { DAY, storedFund, resolveFund };
