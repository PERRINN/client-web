import { friendlyDateLabel } from '../chatDate';
import { Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { ChatDataService } from '../chatData.service';
import { ChatEvent, EventDraft, eventDraft, eventDurationLabel, eventFromDraft, eventLocationUrl } from './chatEvent';

@Component({
  selector: 'app-chat-event-editor', templateUrl: './chat-event-editor.component.html',
  styleUrls: ['./chat-event-editor.component.css'], standalone: false
})
export class ChatEventEditorComponent implements OnChanges, OnDestroy {
  @Input() chain = '';
  @Input() event: ChatEvent | null = null;
  @Input() signedIn = false;
  @Output() busyChange = new EventEmitter<boolean>();
  @ViewChild('keepEventButton') keepEventButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('eventSection') eventSection?: ElementRef<HTMLElement>;
  @ViewChild('descriptionInput') descriptionInput?: ElementRef<HTMLTextAreaElement>;
  editing = false;
  saving = false;
  confirmingCancel = false;
  error = '';
  notice = '';
  draft: EventDraft = eventDraft(null);
  durationPreset = '1';
  readonly dateLabel = (timestamp: number) => friendlyDateLabel(timestamp, Date.now(), true);
  readonly durationLabel = eventDurationLabel;
  readonly locationUrl = eventLocationUrl;
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  private original = '';
  private initialDraft = '';
  private currentChain = '';
  private generation = 0;

  constructor(private data: ChatDataService, private zone: NgZone) {}
  get changed(): boolean { return !this.active || JSON.stringify(this.draft) !== this.initialDraft; }
  get active(): boolean { return !!this.event && this.event.end > Date.now(); }
  get timezoneLabel(): string {
    const candidate = new Date(`${this.draft.date}T${this.draft.time}`);
    return `${this.timezone} · ${new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(Number.isFinite(candidate.getTime()) ? candidate : new Date()).find(part => part.type === 'timeZoneName')?.value || ''}`;
  }

  ngOnChanges(): void {
    if (this.chain !== this.currentChain) {
      this.generation++; this.currentChain = this.chain; this.editing = false; this.saving = false;
      this.confirmingCancel = false; this.error = ''; this.notice = '';
    }
    if (!this.signedIn) this.editing = this.confirmingCancel = false;
    if (this.confirmingCancel && JSON.stringify(this.event) !== this.original) {
      this.confirmingCancel = false; this.error = 'The event changed. Review it before cancelling.';
    }
  }

  focus(): void {
    this.eventSection?.nativeElement.focus({ preventScroll: true });
    this.eventSection?.nativeElement.scrollIntoView({ block: 'nearest' });
  }

  edit(): void {
    if (!this.signedIn || this.saving) return;
    this.original = JSON.stringify(this.event); this.draft = eventDraft(this.event); this.initialDraft = JSON.stringify(this.draft);
    this.durationPreset = [0.5, 1, 1.5, 2].includes(this.draft.duration) ? String(this.draft.duration) : 'custom';
    this.error = ''; this.notice = ''; this.confirmingCancel = false; this.editing = true;
    requestAnimationFrame(() => this.descriptionInput?.nativeElement.focus());
  }

  chooseDuration(value: string): void { this.durationPreset = value; if (value !== 'custom') this.draft.duration = Number(value); }
  dismiss(): void { if (!this.saving) { this.editing = false; this.confirmingCancel = false; this.error = ''; this.focus(); } }
  escape(event: Event): void { if (this.editing || this.confirmingCancel || this.saving) { event.stopPropagation(); this.dismiss(); } }
  askCancel(): void {
    this.original = JSON.stringify(this.event); this.confirmingCancel = true; this.error = ''; this.notice = '';
    requestAnimationFrame(() => this.keepEventButton?.nativeElement.focus());
  }

  async save(): Promise<void> {
    if (!this.signedIn || this.saving || !this.changed) return;
    let event: ChatEvent;
    try {
      if (JSON.stringify(this.event) !== this.original) throw new Error('The event changed. Close the editor and try again.');
      event = eventFromDraft(this.draft);
    } catch (error) { this.error = (error as Error).message; return; }
    await this.submit(() => this.data.saveEvent(this.chain, event, this.event), 'Event update sent');
  }

  async cancel(): Promise<void> {
    if (!this.signedIn || this.saving || !this.confirmingCancel || !this.active) return;
    if (JSON.stringify(this.event) !== this.original) { this.error = 'The event changed. Review it before cancelling.'; this.confirmingCancel = false; return; }
    const event = this.event;
    if (event) await this.submit(() => this.data.cancelEvent(this.chain, event), 'Cancellation sent');
  }

  private async submit(write: () => Promise<void>, notice: string): Promise<void> {
    const generation = this.generation;
    this.saving = true; this.error = ''; this.busyChange.emit(true);
    try {
      await write();
      this.zone.run(() => { if (generation === this.generation) { this.editing = false; this.confirmingCancel = false; this.notice = notice; this.focus(); } });
    } catch {
      this.zone.run(() => { if (generation === this.generation) this.error = 'Changes couldn’t save. Try again.'; });
    } finally {
      this.zone.run(() => { if (generation === this.generation) { this.saving = false; this.busyChange.emit(false); } });
    }
  }
  ngOnDestroy(): void { this.generation++; }
}
