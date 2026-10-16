import { Component, EventEmitter, Input, Output } from '@angular/core';
import { activeFund, ChatFund, FundCurrency, fundAmount, fundProgress } from './chatFund';

@Component({
  selector: 'app-chat-fund-summary', templateUrl: './chat-fund-summary.component.html',
  styleUrls: ['./chat-fund-summary.component.css'], standalone: false,
  host: { '[class.has-fund]': 'active' }
})
export class ChatFundSummaryComponent {
  @Input() fund: ChatFund | null = null;
  @Input() currency: FundCurrency = { code: 'gbp', perGBP: 1 };
  @Output() openFund = new EventEmitter<void>();
  readonly progress = fundProgress;
  get active(): boolean { return activeFund(this.fund); }
  amount(value: number): string { return fundAmount(value, this.currency); }
}
