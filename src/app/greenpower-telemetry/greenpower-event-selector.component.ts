import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { EVENT_TYPES, eventType, EventFilters } from './greenpowerEvents';
import { GreenpowerEventsService } from './greenpowerEvents.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';

@Component({ selector: 'app-greenpower-event-selector', standalone: false,
  templateUrl: './greenpower-event-selector.component.html', styleUrls: ['./greenpower-event-selector.component.css'] })
export class GreenpowerEventSelectorComponent implements OnInit, OnDestroy {
  @Input() locked = false;
  @Output() daySelect = new EventEmitter<string>();
  get mode() { return this.events.historySource; }
  set mode(value: 'events' | 'days') { this.events.historySource = value; }
  filters: EventFilters;
  readonly types = EVENT_TYPES;
  eventType = eventType;
  private readonly changes: Subscription;
  constructor(public events: GreenpowerEventsService, public telemetry: GreenpowerTelemetryService, change: ChangeDetectorRef) {
    this.filters = { ...events.filters };
    this.changes = events.changed.subscribe(() => change.markForCheck());
    this.changes.add(telemetry.changed.subscribe(() => change.markForCheck()));
  }
  ngOnInit() { if (!this.events.loadedEvents && !this.events.loadingEvents) void this.events.loadEvents(); }
  get selectedOutsidePage() { return this.events.selectedEvent && !this.events.events.some(event => event.id === this.events.eventId); }
  get sessionOutsidePage() { return this.events.selectedSession && !this.events.sessions.some(session => session.id === this.events.sessionId); }
  apply() { if (!this.locked) void this.events.loadEvents(true, this.filters); }
  ngOnDestroy() { this.changes.unsubscribe(); }
}
