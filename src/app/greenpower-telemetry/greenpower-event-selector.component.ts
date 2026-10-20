import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { sessionLabel } from './greenpowerDay';
import { GreenpowerEventsService } from './greenpowerEvents.service';

@Component({ selector: 'app-greenpower-event-selector', standalone: false,
  templateUrl: './greenpower-event-selector.component.html', styleUrls: ['./greenpower-event-selector.component.css'] })
export class GreenpowerEventSelectorComponent implements OnInit, OnDestroy {
  @Input() locked = false;
  @Input() loading = false;
  @Output() loadRecording = new EventEmitter<void>();
  readonly currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/London', year: 'numeric' }).format(new Date()));
  readonly years = Array.from({ length: Math.max(1, this.currentYear - 2025) }, (_, index) => 2026 + index);
  year = this.currentYear;
  sessionLabel = sessionLabel;
  private readonly changes: Subscription;
  constructor(public events: GreenpowerEventsService, change: ChangeDetectorRef) {
    this.year = Number(events.filters.from.slice(0, 4)) || this.currentYear;
    this.changes = events.changed.subscribe(() => change.markForCheck());
  }
  ngOnInit() {
    if (!this.events.loadedEvents && !this.events.loadingEvents) void this.events.loadEvents();
  }
  get selectedOutsidePage() { return this.events.selectedEvent && !this.events.events.some(event => event.date === this.events.eventId); }
  get sessionInPage() { return this.events.sessions.some(session => session.id === this.events.sessionId); }
  selectYear(year: number) {
    if (this.locked || year === this.year) return;
    this.year = year;
    this.events.selectSession('');
    void this.events.loadEvents(true, { type: '', location: '', from: `${year}-01-01`, to: `${year}-12-31` });
  }
  ngOnDestroy() { this.changes.unsubscribe(); }
}
