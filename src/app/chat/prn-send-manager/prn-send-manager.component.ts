import { Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Subscription } from 'rxjs';
import { emptyTransferDraft, TransferMember, TransferReview } from './prnTransfer';
import { PrnTransferService } from './prnTransfer.service';

@Component({ selector: 'app-prn-send-manager', templateUrl: './prn-send-manager.component.html', styleUrls: ['./prn-send-manager.component.css'], standalone: false })
export class PrnSendManagerComponent implements OnChanges, OnDestroy {
  @Input() chain = '';
  @Input() signedIn = false;
  @Input() members: TransferMember[] = [];
  @Output() busyChange = new EventEmitter<boolean>();
  @ViewChild('amountInput') amountInput?: ElementRef<HTMLInputElement>;
  @ViewChild('reviewHeading') reviewHeading?: ElementRef<HTMLElement>;
  @ViewChild('openButton') openButton?: ElementRef<HTMLButtonElement>;
  editing = false;
  busy = false;
  error = '';
  notice = '';
  pendingMessageId = '';
  draft = emptyTransferDraft();
  review: TransferReview | null = null;
  private currentChain = '';
  private userId = '';
  private generation = 0;
  private authSubscription: Subscription;
  get context() { return this.transfers.context; }
  get balanceLabel(): string {
    const context = this.context;
    return context && Number.isFinite(context.balance) && Number.isFinite(context.rate) && context.rate > 0
      ? `${context.currency.toUpperCase()} ${(context.balance / context.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Unavailable';
  }

  constructor(private transfers: PrnTransferService, auth: AngularFireAuth, private zone: NgZone) {
    this.authSubscription = auth.authState.subscribe(user => this.zone.run(() => {
      const userId = user?.uid || '';
      if (userId !== this.userId) { this.userId = userId; this.reset(); }
    }));
  }
  ngOnChanges(): void {
    if (this.chain !== this.currentChain || !this.signedIn) { this.currentChain = this.chain; this.reset(); }
  }
  private reset(): void {
    this.generation++; this.editing = this.busy = false; this.review = null; this.draft = emptyTransferDraft();
    this.error = this.notice = this.pendingMessageId = ''; this.busyChange.emit(false);
  }
  open(): void {
    if (!this.signedIn || !this.chain || this.busy) return;
    this.editing = true; this.error = this.notice = ''; this.pendingMessageId = '';
    requestAnimationFrame(() => this.amountInput?.nativeElement.focus());
  }
  cancel(): void { if (!this.busy) { this.reset(); requestAnimationFrame(() => this.openButton?.nativeElement.focus()); } }
  back(): void { if (!this.busy) { this.review = null; this.error = ''; requestAnimationFrame(() => this.amountInput?.nativeElement.focus()); } }
  escape(event: Event): void { if (this.editing || this.busy) { event.stopPropagation(); this.cancel(); } }

  async prepare(): Promise<void> {
    if (this.busy || !this.signedIn || !this.editing) return;
    const generation = this.generation;
    this.setBusy(true); this.error = '';
    try {
      const review = await this.transfers.prepare(this.chain, { ...this.draft });
      this.zone.run(() => {
        if (generation !== this.generation) return;
        this.review = review;
        requestAnimationFrame(() => this.reviewHeading?.nativeElement.focus());
      });
    } catch (error) { this.showError(error, generation, 'Transfer details couldn’t load. Try again.'); }
    finally { this.zone.run(() => { if (generation === this.generation) this.setBusy(false); }); }
  }

  async confirm(): Promise<void> {
    if (this.busy || !this.signedIn || !this.review) return;
    const generation = this.generation, review = this.review;
    this.setBusy(true); this.error = '';
    try {
      await this.transfers.submit(review);
      this.zone.run(() => {
        if (generation !== this.generation) return;
        this.editing = false; this.review = null; this.draft = emptyTransferDraft();
        this.notice = review.mode === 'pending' ? 'Pending transfer submitted' : 'Transfer submitted';
        this.pendingMessageId = review.mode === 'pending' ? review.messageId : '';
        requestAnimationFrame(() => this.openButton?.nativeElement.focus());
      });
    } catch (error) { this.showError(error, generation, 'Transfer couldn’t submit. Retry this transfer.'); }
    finally { this.zone.run(() => { if (generation === this.generation) this.setBusy(false); }); }
  }
  private setBusy(busy: boolean): void { this.busy = busy; this.busyChange.emit(busy); }
  private showError(error: unknown, generation: number, fallback: string): void {
    this.zone.run(() => {
      if (generation === this.generation) this.error = error instanceof Error && !('code' in error) ? error.message : fallback;
    });
  }
  ngOnDestroy(): void { this.generation++; this.authSubscription.unsubscribe(); }
}
