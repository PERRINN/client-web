import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { activeFund, ChatFund, FundCurrency, fundAmount, fundClock, fundProgress, fundStatus } from './chatFund';

@Component({
  selector: 'app-chat-fund-summary', templateUrl: './chat-fund-summary.component.html',
  styleUrls: ['./chat-fund-summary.component.css'], standalone: false,
  host: { '[class.has-fund]': 'visible', '[class.row-layout]': 'layout === "row"' }
})
export class ChatFundSummaryComponent implements OnChanges, OnDestroy {
  @Input() fund: ChatFund | null = null;
  @Input() currency: FundCurrency = { code: 'gbp', perGBP: 1 };
  @Input() layout: 'compact' | 'row' = 'compact';
  @Input() subject = '';
  @Input() image = '';
  @Input() showEnded = false;
  @Output() openFund = new EventEmitter<void>();
  readonly progress = fundProgress;
  readonly status = fundStatus;
  now = Date.now();
  failedImage = '';
  private clock?: Subscription;
  get active(): boolean { return activeFund(this.fund, this.now); }
  get visible(): boolean { return !!this.fund && (this.showEnded || this.active); }
  get description(): string {
    const value = this.fund?.description.trim() || '';
    return value.toLowerCase() === 'add a description' ? '' : value;
  }
  get heading(): string { return (this.layout === 'row' ? this.subject.trim() : '') || this.description || 'Fund'; }
  get showDescription(): boolean { return this.layout === 'row' && !!this.description && this.description.toLowerCase() !== this.heading.toLowerCase(); }
  amount(value: number): string { return fundAmount(value, this.currency); }
  ngOnChanges(): void {
    this.clock?.unsubscribe();
    this.clock = fundClock([this.fund]).subscribe(now => this.now = now);
  }
  ngOnDestroy(): void { this.clock?.unsubscribe(); }
}
