import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { EventFilters } from './greenpowerEvents';
import { DAY_SESSION_TYPES, sessionLabel } from './greenpowerDay';
import { GreenpowerEventsService } from './greenpowerEvents.service';

@Component({ selector: 'app-greenpower-event-selector', standalone: false,
  templateUrl: './greenpower-event-selector.component.html', styleUrls: ['./greenpower-event-selector.component.css'] })
export class GreenpowerEventSelectorComponent implements OnInit, OnDestroy {
  @Input() locked = false;
  @Input() loading = false;
  @Output() loadRecording = new EventEmitter<void>();
  filters: EventFilters;
  readonly currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/London', year: 'numeric' }).format(new Date()));
  readonly years = Array.from({ length: Math.max(1, this.currentYear - 2025) }, (_, index) => 2026 + index);
  year = this.currentYear;
  readonly types = DAY_SESSION_TYPES;
  sessionLabel = sessionLabel;
  private readonly changes: Subscription;
  constructor(public events: GreenpowerEventsService, change: ChangeDetectorRef) {
    this.filters = { ...events.filters }; this.year = Number(events.filters.from.slice(0, 4)) || this.currentYear;
    this.changes = events.changed.subscribe(() => change.markForCheck());
  }
  ngOnInit() {
    if (!this.events.loadedEvents && !this.events.loadingEvents) void this.events.loadEvents();
    if (!this.events.tracks.length && !this.events.loadingTracks) void this.events.loadTracks();
  }
  get selectedOutsidePage() { return this.events.selectedEvent && !this.events.events.some(event => event.date === this.events.eventId); }
  get sessionInPage() { return this.events.sessions.some(session => session.id === this.events.sessionId); }
  apply() { if (!this.locked) { this.events.selectSession(''); void this.events.loadEvents(true, { ...this.filters, from: `${this.year}-01-01`, to: `${this.year}-12-31` }); } }
  ngOnDestroy() { this.changes.unsubscribe(); }
}
