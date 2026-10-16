export interface TransferMember { id: string; name: string; avatarName: string; avatar: string; }
export interface TransferDraft { mode: 'direct' | 'pending'; recipient: string; amount: number | null; code: string; reference: string; }
export interface TransferContext {
  userId: string; name: string; avatar: string; balance: number; currency: string; rate: number;
}
export interface TransferReview {
  messageId: string; chain: string; userId: string; currency: string; rate: number;
  amount: number; prnAmount: number; recipient: string | null; recipientName: string;
  mode: 'direct' | 'pending'; code: string | null; reference: string;
}
export const emptyTransferDraft = (): TransferDraft => ({ mode: 'direct', recipient: '', amount: null, code: '', reference: '' });

// Validation supports the UI; existing rules and Functions remain the trust boundary.
export function reviewTransfer(chain: string, draft: TransferDraft, context: TransferContext, members: TransferMember[]): Omit<TransferReview, 'messageId'> {
  if (!chain || !context.userId) throw new Error('Choose a conversation and sign in.');
  if (!context.currency || !Number.isFinite(context.rate) || context.rate <= 0) throw new Error('Currency rates are unavailable. Try again.');
  if (!Number.isFinite(context.balance) || context.balance < 0) throw new Error('Your balance is unavailable. Try again.');
  const amount = Number(draft.amount), reference = draft.reference.trim(), code = draft.code.trim() || null;
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw new Error('Enter an amount greater than zero with up to two decimal places.');
  }
  const prnAmount = Math.round(amount * context.rate * 100000) / 100000;
  if (!Number.isSafeInteger(Math.round(prnAmount * 100000)) || prnAmount <= 0) throw new Error('Enter an amount worth at least 0.00001 PRN.');
  if (prnAmount > context.balance) throw new Error('The amount exceeds your available balance.');
  if (!reference || reference.length > 500) throw new Error('Enter a reference of up to 500 characters.');
  if (code && code.length > 500) throw new Error('Use a code of up to 500 characters.');
  if (draft.mode !== 'direct' && draft.mode !== 'pending') throw new Error('Choose a transfer type.');
  const member = members.find(person => person.id === draft.recipient);
  if (draft.mode === 'direct' && (!member || (member.id === context.userId && !code))) throw new Error('Choose a participant. Sending to yourself requires a code.');
  return { chain, userId: context.userId, currency: context.currency, rate: context.rate, amount, prnAmount,
    recipient: draft.mode === 'direct' ? member!.id : null, recipientName: draft.mode === 'direct' ? member!.name : 'Pending activation',
    mode: draft.mode, code, reference };
}

export function transferMessage(review: TransferReview) {
  // Keep the command text within the rules' limit without truncating structured fields.
  const text = `${review.mode === 'direct' ? 'Sending' : 'Creating pending transfer of'} ${review.prnAmount} PRN${review.recipient ? ` to ${review.recipientName}` : ''} (Reference: ${review.reference})`.slice(0, 500);
  const fields = { amount: review.prnAmount, code: review.code, reference: review.reference };
  return { chain: review.chain, text, ...(review.mode === 'direct' ? { transactionOut: { user: review.recipient, ...fields } } : { transactionPending: fields }) };
}
