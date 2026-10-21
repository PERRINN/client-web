// Validate explicit fund commands before the message verifier performs any writes.
// Inherited totals need no Auth lookup; zero is a deliberate raised correction.
async function validateFundCommand(fund, user, auth) {
  if (fund === undefined) return undefined;
  if (!fund || typeof fund !== 'object' || Array.isArray(fund)) throw new Error('Invalid fund command');
  let cancelling = false;
  for (const [key, minimum] of [['amountGBPTarget', 0.01], ['daysLeft', 1]]) {
    if (!Object.prototype.hasOwnProperty.call(fund, key)) continue;
    if (!Number.isFinite(fund[key])) throw new Error('Invalid fund command');
    if (fund[key] !== 0 && fund[key] < minimum) cancelling = true;
  }
  const correcting = Object.prototype.hasOwnProperty.call(fund, 'amountGBPRaised');
  if (correcting && (!Number.isFinite(fund.amountGBPRaised) || fund.amountGBPRaised < 0 || fund.amountGBPRaised > 90071992547409)) throw new Error('Invalid raised amount');
  if (correcting || cancelling) {
    const account = await auth.getUser(user);
    if (account.disabled || account.customClaims?.perrinnAdmin !== true) throw new Error('Admin permission is required to manage raised totals or cancel funds');
  }
  return correcting ? fund.amountGBPRaised : undefined;
}
module.exports = { validateFundCommand };
