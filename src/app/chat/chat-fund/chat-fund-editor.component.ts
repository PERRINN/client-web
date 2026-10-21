import { Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { PermissionsService } from '../../permissions.service';
import { ChatDataService } from '../chatData.service';
import { activeFund, ChatFund, FundCurrency, FundDraft, fundAmount, fundFromDraft, fundProgress, raisedFromDraft, fundClock, fundDays, fundStatus, fundIdentity } from './chatFund';

@Component({
  selector: 'app-chat-fund-editor', templateUrl: './chat-fund-editor.component.html',
  styleUrls: ['./chat-fund-editor.component.css'], standalone: false
})
export class ChatFundEditorComponent implements OnChanges, OnDestroy {
  @Input() chain = '';
  @Input() fund: ChatFund | null = null;
  @Input() signedIn = false;
  @Output() busyChange = new EventEmitter<boolean>();
  @ViewChild('fundSection') section?: ElementRef<HTMLElement>;
  @ViewChild('descriptionInput') descriptionInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('keepFundButton') keepButton?: ElementRef<HTMLButtonElement>;
  editing = false;
  saving = false;
  confirmingCancel = false;
  error = '';
  notice = '';
  draft: FundDraft = { description: '', amount: null, days: 30 };
  editCurrency: FundCurrency = { code: 'gbp', perGBP: 1 };
  readonly progress = fundProgress;
  now = Date.now();
  readonly status = fundStatus;
  private clock?: Subscription;
  private original = '';
  private editingActive = false;
  private initialDraft = '';
  private currentChain = '';
  private generation = 0;

  constructor(private data: ChatDataService, private zone: NgZone, public permissions: PermissionsService) {}
  get isAdmin(): boolean { return this.signedIn && this.permissions.current.ready && this.permissions.current.isAdmin; }
  get active(): boolean { return activeFund(this.fund, this.now); }
  get changed(): boolean { return !this.active || JSON.stringify(this.draft) !== this.initialDraft; }
  amount(value: number): string { return fundAmount(value, this.data.fundCurrency); }
  ngOnChanges(): void {
    this.clock?.unsubscribe();
    this.clock = fundClock([this.fund]).subscribe(now => this.now = now);
    if (this.chain !== this.currentChain) {
      this.generation++; this.currentChain = this.chain; this.editing = this.saving = this.confirmingCancel = false;
      this.error = this.notice = '';
    }
    if (!this.signedIn) this.editing = this.confirmingCancel = false;
    if (this.confirmingCancel && fundIdentity(this.fund) !== this.original) {
      this.confirmingCancel = false; this.error = 'The fund changed. Review it before cancelling.';
    }
  }
  focus(): void { this.section?.nativeElement.focus({ preventScroll: true }); this.section?.nativeElement.scrollIntoView({ block: 'nearest' }); }
  edit(): void {
    if (!this.signedIn || this.saving) return;
    this.editingActive = this.active;
    this.original = fundIdentity(this.fund); this.editCurrency = this.data.fundCurrency;
    this.draft = { description: this.fund?.description || '', amount: this.fund ? Math.round(this.fund.amountGBPTarget * this.editCurrency.perGBP * 100) / 100 : null,
      days: this.active ? Math.max(1, fundDays(this.fund!, this.now)) : 30 };
    if (this.isAdmin) this.draft.raised = Math.round((this.fund?.amountGBPRaised || 0) * this.editCurrency.perGBP * 100) / 100;
    this.initialDraft = JSON.stringify(this.draft); this.error = this.notice = ''; this.confirmingCancel = false; this.editing = true;
    requestAnimationFrame(() => this.descriptionInput?.nativeElement.focus());
  }
  dismiss(): void { if (!this.saving) { this.editing = this.confirmingCancel = false; this.error = ''; this.focus(); } }
  escape(event: Event): void { if (this.editing || this.confirmingCancel || this.saving) { event.stopPropagation(); this.dismiss(); } }
  askCancel(): void {
    if (!this.isAdmin || this.saving || !this.active) return;
    this.original = fundIdentity(this.fund); this.confirmingCancel = true; this.error = this.notice = '';
    requestAnimationFrame(() => this.keepButton?.nativeElement.focus());
  }
  async save(): Promise<void> {
    if (!this.signedIn || this.saving || !this.editing || !this.changed) return;
    let fields: ReturnType<typeof fundFromDraft> & { amountGBPRaised?: number };
    try {
      if (this.editingActive && !this.active) throw new Error('The fund ended. Close the editor and try again.');
      if (fundIdentity(this.fund) !== this.original) throw new Error('The fund changed. Close the editor and try again.');
      if (JSON.stringify(this.editCurrency) !== JSON.stringify(this.data.fundCurrency)) throw new Error('Currency rates changed. Close the editor and try again.');
      fields = fundFromDraft(this.draft, this.editCurrency);
      if (this.draft.raised !== JSON.parse(this.initialDraft).raised) {
        if (!this.isAdmin) throw new Error('Admin permission is required to change the raised amount.');
        fields.amountGBPRaised = raisedFromDraft(this.draft.raised ?? null, this.editCurrency);
      }
      // Do not round-trip an unchanged GBP target through a rounded display currency.
      if (this.fund && this.draft.amount === JSON.parse(this.initialDraft).amount) fields.amountGBPTarget = this.fund.amountGBPTarget;
    } catch (error) { this.error = (error as Error).message; return; }
    const closesAt = this.active && this.draft.days === JSON.parse(this.initialDraft).days ? this.fund?.closesAt : undefined;
    await this.submit(() => this.data.saveFund(this.chain, fields, this.active, closesAt), 'Fund update sent');
  }
  async cancel(): Promise<void> {
    if (!this.isAdmin || this.saving || !this.confirmingCancel || !this.active || !this.fund) return;
    if (fundIdentity(this.fund) !== this.original) { this.confirmingCancel = false; this.error = 'The fund changed. Review it before cancelling.'; return; }
    await this.submit(() => this.data.cancelFund(this.chain, this.fund!), 'Cancellation sent');
  }
  private async submit(write: () => Promise<void>, notice: string): Promise<void> {
    const generation = this.generation;
    this.saving = true; this.error = ''; this.busyChange.emit(true);
    try {
      await write();
      this.zone.run(() => { if (generation === this.generation) { this.editing = this.confirmingCancel = false; this.notice = notice; this.focus(); } });
    } catch {
      this.zone.run(() => { if (generation === this.generation) this.error = 'Changes couldn’t save. Try again.'; });
    } finally { this.zone.run(() => { if (generation === this.generation) { this.saving = false; this.busyChange.emit(false); } }); }
  }
  ngOnDestroy(): void { this.generation++; this.clock?.unsubscribe(); }
}
