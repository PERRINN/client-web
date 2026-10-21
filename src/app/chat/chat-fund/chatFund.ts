import { defer, EMPTY, Observable, of, timer } from 'rxjs';
import { expand, map } from 'rxjs/operators';
export interface ChatFund {
  description: string;
  amountGBPTarget: number;
  amountGBPRaised: number;
  daysLeft: number;
  closesAt?: number | null;
  cancelled?: boolean;
}
export interface FundDraft { description: string; amount: number | null; days: number | null; raised?: number | null; }
export interface FundCurrency { code: string; perGBP: number; }
export function fundCurrency(userCurrency?: string, rates: Record<string, { toCOIN?: number }> = {}): FundCurrency {
  const code = String(userCurrency || 'gbp').toLowerCase();
  const perGBP = Number(rates.gbp?.toCOIN) / Number(rates[code]?.toCOIN);
  if (!Number.isFinite(perGBP) || perGBP <= 0) return { code: 'gbp', perGBP: 1 };
  try { new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }); }
  catch { return { code: 'gbp', perGBP: 1 }; }
  return { code, perGBP };
}

export const FUND_DAY = 86400000;
export interface FundRecord { fund?: Partial<ChatFund>; verifiedTimestamp?: number | { seconds?: number; toMillis?: () => number }; }
export function chatFund(record: FundRecord, now = Date.now()): ChatFund | null {
  const fund = record.fund;
  if (!fund || !Number.isFinite(fund.amountGBPTarget) || fund.amountGBPTarget! < 0.01) return null;
  const stamp = record.verifiedTimestamp;
  const reference = typeof stamp === 'number' ? stamp : stamp?.toMillis?.() || (Number(stamp?.seconds) * 1000 || 0);
  const closesAt = Number.isSafeInteger(fund.closesAt) && fund.closesAt! > 0 ? fund.closesAt!
    : reference > 0 && Number.isFinite(fund.daysLeft) ? Math.round(reference + fund.daysLeft! * FUND_DAY) : null;
  return { description: typeof fund.description === 'string' ? fund.description : '', amountGBPTarget: fund.amountGBPTarget!,
    amountGBPRaised: Number.isFinite(fund.amountGBPRaised) ? Math.max(0, fund.amountGBPRaised!) : 0,
    closesAt, cancelled: fund.cancelled === true, daysLeft: closesAt ? Math.max(0, (closesAt - now) / FUND_DAY) : 0 };
}
export const activeFund = (fund: ChatFund | null, now = Date.now()): boolean => !!fund && fund.amountGBPTarget >= 0.01 && !fund.cancelled && Number(fund.closesAt) > now;
export const fundDays = (fund: ChatFund, now = Date.now()): number => Math.max(0, Math.ceil((Number(fund.closesAt) - now) / FUND_DAY));
export function fundStatus(fund: ChatFund, now = Date.now()): string {
  if (fund.cancelled) return 'Cancelled';
  if (!activeFund(fund, now)) return 'Ended';
  const days = fundDays(fund, now);
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
}
// Local-only clock: wake at expiry, a displayed day boundary, or after tab suspension.
// There are no database requests or repeated application subscriptions here.
export function fundClock(funds: Array<ChatFund | null>): Observable<number> {
  const nextDelay = (now: number) => Math.max(1, Math.min(60000, ...funds.filter(fund => activeFund(fund, now)).map(fund => {
    const remaining = Number(fund!.closesAt) - now;
    return remaining - (Math.ceil(remaining / FUND_DAY) - 1) * FUND_DAY;
  })));
  return defer(() => of(Date.now())).pipe(expand(now => funds.some(fund => activeFund(fund, now)) ? timer(nextDelay(now)).pipe(map(() => Date.now())) : EMPTY));
}
export const fundIdentity = (fund: ChatFund | null): string => JSON.stringify(fund && {
  description: fund.description, amountGBPTarget: fund.amountGBPTarget, amountGBPRaised: fund.amountGBPRaised,
  closesAt: fund.closesAt, cancelled: fund.cancelled
});
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

export function raisedFromDraft(value: number | null, currency: FundCurrency): number {
  if (value === null || !Number.isFinite(value) || value < 0) throw new Error('Enter a raised amount of zero or more.');
  if (!Number.isFinite(currency.perGBP) || currency.perGBP <= 0) throw new Error('Currency rates are unavailable. Try again.');
  const amount = Math.round(value / currency.perGBP * 100) / 100;
  if (!Number.isFinite(amount) || amount > 90071992547409 || !Number.isSafeInteger(Math.round(amount * 100))) throw new Error('The raised amount is too large.');
  return amount;
}
