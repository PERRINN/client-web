export interface TransferFields {
  amount?: number | null; user?: string | null; name?: string | null; message?: string | null;
  reference?: string | null; code?: string | null; activated?: boolean;
}
export interface TransferRecord {
  chain?: string; user?: string; name?: string; verified?: boolean;
  recipients?: Record<string, { name?: string }>;
  transactionOut?: TransferFields; transactionIn?: TransferFields; transactionPending?: TransferFields;
}
export interface TransferSummary {
  kind: 'outgoing' | 'incoming' | 'pending'; title: string; amount: number;
  from: string; to: string; reference: string; code: string; status: string; activationId: string;
}
const positiveAmount = (fields?: TransferFields) => typeof fields?.amount === 'number' && Number.isFinite(fields.amount) && fields.amount > 0;

// Project only transfer display fields; never pass the raw account/ledger record to a template.
export function transferSummaries(id: string, record: TransferRecord, viewer: string | null, source?: TransferRecord): TransferSummary[] {
  const summaries: TransferSummary[] = [];
  const name = (user?: string | null, fallback?: string | null) => user && user === viewer ? 'You'
    : fallback || (user && record.recipients?.[user]?.name) || (user && user === record.user ? record.name : '') || 'Contributor';
  const status = record.verified === true ? 'Recorded' : record.verified === false ? 'Not verified' : 'Processing';
  if (positiveAmount(record.transactionOut)) {
    const fields = record.transactionOut!;
    summaries.push({ kind: 'outgoing', title: 'PRN transfer', amount: fields.amount!, from: name(record.user), to: name(fields.user, fields.name),
      reference: fields.reference || '', code: fields.code || '', status, activationId: '' });
  }
  if (positiveAmount(record.transactionIn)) {
    const fields = record.transactionIn!;
    // An exact loaded source can supply the reference omitted by the receipt handler.
    const linked = source && source.chain === record.chain && source.user === fields.user
      && source.transactionOut?.user === record.user && source.transactionOut.amount === fields.amount ? source : undefined;
    summaries.push({ kind: 'incoming', title: !fields.user ? 'PRN balance credit' : record.verified === true ? 'PRN received' : 'Incoming PRN transfer', amount: fields.amount!,
      from: fields.user ? name(fields.user, fields.name || linked?.name) : '', to: name(record.user), reference: fields.reference || linked?.transactionOut?.reference || '',
      code: fields.code || linked?.transactionOut?.code || '', status, activationId: '' });
  }
  if (positiveAmount(record.transactionPending)) {
    const fields = record.transactionPending!, awaiting = record.verified === true && fields.activated !== true;
    summaries.push({ kind: 'pending', title: 'Pending PRN transfer', amount: fields.amount!, from: name(record.user), to: '',
      reference: fields.reference || '', code: fields.code || '',
      status: record.verified === true ? fields.activated === true ? 'Activated' : 'Awaiting activation' : status, activationId: awaiting ? id : '' });
  }
  return summaries;
}
