import { ChangeDetectorRef, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { SESSION_TYPES } from './greenpowerEvents';
import { ChartWindow } from './greenpowerChart';
import { GreenpowerEventEditService } from './greenpowerEventEdit.service';
import { GreenpowerEventsService } from './greenpowerEvents.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';

@Component({ selector: 'app-greenpower-event-editor', standalone: false,
  templateUrl: './greenpower-event-editor.component.html', styleUrls: ['./greenpower-event-editor.component.css'] })
export class GreenpowerEventEditorComponent implements OnDestroy {
  @Input() range?: ChartWindow;
  @ViewChild('confirmSave') set confirmSave(button: ElementRef<HTMLButtonElement> | undefined) { button?.nativeElement.focus(); }
  private readonly changes: Subscription;
  private readonly format = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'medium' });
  constructor(public edit: GreenpowerEventEditService, public events: GreenpowerEventsService, public telemetry: GreenpowerTelemetryService, change: ChangeDetectorRef) {
    this.changes = edit.changed.subscribe(() => change.markForCheck());
    this.changes.add(events.changed.subscribe(() => change.markForCheck()));
    this.changes.add(telemetry.changed.subscribe(() => change.markForCheck()));
  }
  get window() { return this.range || { start: this.telemetry.start, end: this.telemetry.end }; }
  get canCapture() { return this.events.eventReady && this.telemetry.day === this.events.selectedEvent?.date && !this.telemetry.live && !this.telemetry.loading && !this.telemetry.more && !!this.telemetry.channels.length && !this.telemetry.error; }
  get sessionType() { return SESSION_TYPES.find(type => type.id === this.edit.draft.type)?.label || ''; }
  time(value?: number) { return value === undefined ? '—' : this.format.format(value); }
  ngOnDestroy() { this.changes.unsubscribe(); }
}
