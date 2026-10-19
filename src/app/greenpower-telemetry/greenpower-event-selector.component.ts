import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { SESSION_TYPES, EventFilters } from './greenpowerEvents';
import { GreenpowerEventsService } from './greenpowerEvents.service';

@Component({ selector: 'app-greenpower-event-selector', standalone: false,
  templateUrl: './greenpower-event-selector.component.html', styleUrls: ['./greenpower-event-selector.component.css'] })
export class GreenpowerEventSelectorComponent implements OnInit, OnDestroy {
  @Input() locked = false;
  filters: EventFilters;
  readonly currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/London', year: 'numeric' }).format(new Date()));
  readonly years = Array.from({ length: Math.max(1, this.currentYear - 2025) }, (_, index) => 2026 + index);
  year = this.currentYear;
  readonly types = SESSION_TYPES;
  private readonly changes: Subscription;
  constructor(public events: GreenpowerEventsService, change: ChangeDetectorRef) {
    this.filters = { ...events.filters }; this.year = Number(events.filters.from.slice(0, 4)) || this.currentYear;
    this.changes = events.changed.subscribe(() => change.markForCheck());
  }
  ngOnInit() { if (!this.events.loadedEvents && !this.events.loadingEvents) void this.events.loadEvents(); }
  get selectedOutsidePage() { return this.events.selectedEvent && !this.events.events.some(event => event.id === this.events.eventId); }
  get sessionOutsidePage() { return this.events.selectedSession && !this.events.sessions.some(session => session.id === this.events.sessionId); }
  sessionType(type: string) { return this.types.find(value => value.id === type)?.label || type; }
  session(id: string) { if (!this.locked) { if (id) this.events.selectSession(id); else this.events.selectEvent(this.events.eventId); } }
  apply() { if (!this.locked) void this.events.loadEvents(true, { ...this.filters, from: `${this.year}-01-01`, to: `${this.year}-12-31` }); }
  ngOnDestroy() { this.changes.unsubscribe(); }
}
