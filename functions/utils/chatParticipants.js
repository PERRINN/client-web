const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

// Commands are checked before the verifier schedules any persisted changes.
async function validateParticipantChange(message, auth) {
  if (!Object.prototype.hasOwnProperty.call(message, 'participantChange')) return;
  const change = message.participantChange;
  if (!change || typeof change !== 'object' || Array.isArray(change)
      || Object.keys(change).length !== 2 || !['add', 'remove'].includes(change.action)
      || !validId(change.userId) || !validId(message.chain)) throw new Error('Invalid participant change');
  const actor = await auth.getUser(message.user);
  if (actor.disabled || actor.customClaims?.perrinnAdmin !== true) throw new Error('Admin permission is required to manage participants');
  if (change.action === 'add') {
    const target = await auth.getUser(change.userId);
    if (target.disabled) throw new Error('This account is unavailable');
  }
}

function resolveParticipants(message, previous, reprocessing = false) {
  // A trusted replay preserves the recorded result; it must not repeat an old removal.
  if (reprocessing && message.verified === true) return [...new Set(message.recipientList || [])].filter(Boolean);
  const change = message.participantChange;
  const ids = [message.user, message.transactionOut?.user, ...(change ? [] : message.recipientList || []),
    ...(previous.recipientList || [])];
  if (change?.action === 'add') ids.push(change.userId);
  return [...new Set(ids)].filter(id => typeof id === 'string' && !!id && id !== 'undefined'
    && !(change?.action === 'remove' && change.userId === id));
}

module.exports = { validateParticipantChange, resolveParticipants };
