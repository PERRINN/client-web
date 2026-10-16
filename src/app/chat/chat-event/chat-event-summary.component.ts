import { friendlyDateLabel } from '../chatDate';
import { Component, EventEmitter, Input, NgZone, OnDestroy, Output } from '@angular/core';
import { ChatEvent, eventDurationLabel, eventLocationUrl } from './chatEvent';

@Component({
  selector: 'app-chat-event-summary', templateUrl: './chat-event-summary.component.html',
  styleUrls: ['./chat-event-summary.component.css'], standalone: false,
  host: { '[class.has-event]': 'active' }
})
export class ChatEventSummaryComponent implements OnDestroy {
  @Input() event: ChatEvent | null = null;
  @Output() openEvent = new EventEmitter<void>();
  now = Date.now();
  readonly dateLabel = friendlyDateLabel;
  readonly durationLabel = eventDurationLabel;
  private clock: ReturnType<typeof setInterval>;
  constructor(zone: NgZone) { this.clock = setInterval(() => zone.run(() => this.now = Date.now()), 30000); }
  get active(): boolean { return !!this.event && this.event.end > this.now; }
  get joinUrl(): string { return this.active && this.event && this.now >= this.event.start - 300000 ? eventLocationUrl(this.event.location) : ''; }
  ngOnDestroy(): void { clearInterval(this.clock); }
}
