export interface ChatFund {
  description: string;
  amountGBPTarget: number;
  amountGBPRaised: number;
  daysLeft: number;
}
export interface FundDraft { description: string; amount: number | null; days: number | null; }
export interface FundCurrency { code: string; perGBP: number; }
export function fundCurrency(userCurrency?: string, rates: Record<string, { toCOIN?: number }> = {}): FundCurrency {
  const code = String(userCurrency || 'gbp').toLowerCase();
  const perGBP = Number(rates.gbp?.toCOIN) / Number(rates[code]?.toCOIN);
  if (!Number.isFinite(perGBP) || perGBP <= 0) return { code: 'gbp', perGBP: 1 };
  try { new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }); }
  catch { return { code: 'gbp', perGBP: 1 }; }
  return { code, perGBP };
}

// The verifier's legacy cancellation marker is below the display threshold.
export function chatFund(record: { fund?: Partial<ChatFund> }): ChatFund | null {
  const fund = record.fund;
  if (!fund || !Number.isFinite(fund.amountGBPTarget) || fund.amountGBPTarget! < 0.01) return null;
  return {
    description: typeof fund.description === 'string' ? fund.description : '',
    amountGBPTarget: fund.amountGBPTarget!,
    amountGBPRaised: Number.isFinite(fund.amountGBPRaised) ? Math.max(0, fund.amountGBPRaised!) : 0,
    daysLeft: Number.isFinite(fund.daysLeft) ? Math.max(0, fund.daysLeft!) : 0
  };
}
export const activeFund = (fund: ChatFund | null): boolean => !!fund && fund.daysLeft > 0;
export const fundProgress = (fund: ChatFund): number => Math.min(100, Math.max(0, fund.amountGBPRaised / fund.amountGBPTarget * 100));
export function fundAmount(amountGBP: number, currency: FundCurrency): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.code.toUpperCase(), maximumFractionDigits: 0 }).format(amountGBP * currency.perGBP);
}
export function fundFromDraft(draft: FundDraft, currency: FundCurrency): Pick<ChatFund, 'description' | 'amountGBPTarget' | 'daysLeft'> {
  const description = draft.description.trim();
  if (!description || description.length > 200) throw new Error('Enter a description of up to 200 characters.');
  if (!Number.isFinite(currency.perGBP) || currency.perGBP <= 0) throw new Error('Currency rates are unavailable. Try again.');
  const amount = Number(draft.amount), amountGBPTarget = Math.round(amount / currency.perGBP * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amountGBPTarget * 100)) || amountGBPTarget < 0.01) throw new Error('Enter a target worth at least £0.01.');
  const daysLeft = Number(draft.days);
  if (!Number.isSafeInteger(daysLeft) || daysLeft < 1) throw new Error('Enter a whole number of days greater than zero.');
  return { description, amountGBPTarget, daysLeft };
}
