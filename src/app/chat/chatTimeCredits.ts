export interface TimeCreditRecord {
  verified?: boolean;
  contract?: {
    amount?: number | null;
    hoursValidated?: number | null;
    hoursDeclared?: number | null;
    hoursAvailable?: number | null;
    previousContractMessageHoursAvailable?: number | null;
  };
}
export interface TimeCredits {
  amount: number;
  creditedHours: number;
  declaredHours?: number;
  remainingHours?: number;
}
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Use the per-message verification result; never recalculate credits from text or current rates.
export function timeCredits(record: TimeCreditRecord): TimeCredits | null {
  const credit = record.contract;
  if (record.verified !== true || !credit || !nonnegative(credit.amount) || credit.amount <= 0
    || !nonnegative(credit.hoursValidated) || credit.hoursValidated <= 0) return null;
  const remainingHours = nonnegative(credit.previousContractMessageHoursAvailable) ? credit.previousContractMessageHoursAvailable
    : nonnegative(credit.hoursAvailable) ? Math.max(0, credit.hoursAvailable - credit.hoursValidated) : undefined;
  return {
    amount: credit.amount, creditedHours: credit.hoursValidated,
    ...(nonnegative(credit.hoursDeclared) ? { declaredHours: credit.hoursDeclared } : {}),
    ...(remainingHours !== undefined ? { remainingHours } : {})
  };
}

export function creditDuration(hours: number): string {
  if (hours === 0) return '0m';
  if (hours < 1 / 60) return '<1 min';
  const minutes = Math.round(hours * 60);
  return minutes < 60 ? `${minutes}m` : minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
}
