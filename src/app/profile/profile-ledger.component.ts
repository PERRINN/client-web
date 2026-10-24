import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { AgChartOptions } from 'ag-charts-community';
import { UserInterfaceService } from '../userInterface.service';
import { ProfileRecord, illustration, ledgerRows } from './profileModel';
import { profileChart } from './profileCharts';
@Component({ selector: 'app-profile-ledger', templateUrl: './profile-ledger.component.html',
    styleUrls: ['./profile-ledger.component.css'], standalone: false })
export class ProfileLedgerComponent implements OnChanges {
    @Input()
    records: ProfileRecord[] = [];
    @Input()
    profile: ProfileRecord = {};
    @Input()
    mode: 'history' | 'chain' | 'forecast' = 'history';
    @Input()
    rate = 0;
    @Output()
    openMessage = new EventEmitter<ProfileRecord>();
    rows: ReturnType<typeof ledgerRows> = [];
    years: ReturnType<typeof illustration> = [];
    chart: AgChartOptions;
    constructor(public UI: UserInterfaceService) { }
    ngOnChanges() {
        this.rows = ledgerRows(this.records);
        this.years = illustration(this.profile, this.rate).slice(1);
        if (this.mode !== 'chain') {
            const currencies = this.UI.PERRINNAdminLastMessageObj?.currencyList || {};
            const preferred = this.UI.currentUserLastMessageObj?.userCurrency;
            const currency = currencies[preferred] ? preferred : currencies.usd ? 'usd' : Object.keys(currencies)[0] || 'usd';
            this.chart = profileChart(this.profile, this.records, this.mode === 'forecast', this.rate,
                value => this.UI.convertPRNToCurrency(null, value), currency.toUpperCase());
        }
    }
    amount(value: number | null) { return value === null ? '—' : this.UI.convertAndFormatPRNToCurrency(null, value); }
}
