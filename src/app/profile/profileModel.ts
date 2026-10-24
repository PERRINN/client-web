export type ProfileTab = 'overview' | 'inbox' | 'history' | 'chain' | 'forecast';
export type ProfileFeed = 'inbox' | 'history' | 'chain';
export interface MessageTime {
    seconds: number;
    toMillis?: () => number;
}
export interface ProfileRecord {
    id?: string;
    isBackendMessage?: boolean;
    user?: string;
    chain?: string;
    name?: string;
    userPresentation?: string;
    publicLink?: string;
    createdTimestamp?: number;
    serverTimestamp?: MessageTime;
    verifiedTimestamp?: MessageTime;
    imageUrlThumbUser?: string;
    imageUrlMedium?: string;
    imageUrlOriginal?: string;
    chatProfileImageUrlThumb?: string;
    chatProfileImageUrlMedium?: string;
    chatProfileImageUrlOriginal?: string;
    chatSubject?: string;
    text?: string;
    recipients?: Record<string, unknown>;
    wallet?: {
        balance?: number;
    };
    locking?: {
        amountCummulate?: number;
    };
    purchaseCOIN?: {
        amountCummulate?: number;
    };
    transactionIn?: {
        amountCummulate?: number;
    };
    transactionOut?: {
        amountCummulate?: number;
    };
    interest?: {
        amountCummulate?: number;
    };
    contract?: {
        amountCummulate?: number;
        hoursTotal?: number;
        signed?: boolean;
        createdTimestamp?: number;
        level?: number;
        levelTimeAdjusted?: number;
    };
    userChain?: {
        index?: number;
        currentMessage?: string;
        newMonth?: boolean;
    };
}
export function milliseconds(value?: MessageTime): number {
    return value?.toMillis?.() || (value?.seconds || 0) * 1000;
}
export function balanceParts(record: ProfileRecord) {
    return {
        balance: record.wallet?.balance || 0,
        purchase: record.purchaseCOIN?.amountCummulate || 0,
        transaction: (record.transactionIn?.amountCummulate || 0) - (record.transactionOut?.amountCummulate || 0),
        interest: record.interest?.amountCummulate || 0,
        contract: record.contract?.amountCummulate || 0
    };
}
export function ledgerRows(records: ProfileRecord[]) {
    return [...records].reverse().map((record, index, chronological) => {
        const values = balanceParts(record), previous = index ? balanceParts(chronological[index - 1]) : null;
        return {
            record, ...values, timestamp: milliseconds(record.verifiedTimestamp || record.serverTimestamp),
            days: index ? (milliseconds(record.verifiedTimestamp) - milliseconds(chronological[index - 1].verifiedTimestamp)) / 86400000 : null,
            messages: index ? (record.userChain?.index || 0) - (chronological[index - 1].userChain?.index || 0) : null,
            change: previous ? values.balance - previous.balance : null,
            funding: previous ? values.purchase - previous.purchase : null,
            transfers: previous ? values.transaction - previous.transaction : null,
            adjustments: previous ? values.interest - previous.interest : null,
            time: previous ? values.contract - previous.contract : null
        };
    });
}
export function illustration(record: ProfileRecord, rate: number) {
    return Array.from({ length: 21 }, (_, year) => ({ year, balance: (record.wallet?.balance || 0) * Math.exp(rate * year), factor: Math.exp(rate * year) }));
}
