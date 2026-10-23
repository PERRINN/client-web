import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { DaySession, sessionLabel } from './greenpowerDay';
import { ChartWindow } from './greenpowerChart';
import { GreenpowerEventEditService } from './greenpowerEventEdit.service';
import { GreenpowerEventsService } from './greenpowerEvents.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';

@Component({ selector: 'app-greenpower-event-editor', standalone: false,
  templateUrl: './greenpower-event-editor.component.html', styleUrls: ['./greenpower-event-editor.component.css'] })
export class GreenpowerEventEditorComponent implements OnDestroy {
  @ViewChild('keepSession') set keepSession(button: ElementRef<HTMLButtonElement> | undefined) {
    if (button) queueMicrotask(() => { if (button.nativeElement.isConnected) button.nativeElement.focus({ preventScroll: true }); });
  }
  @Input() sessions: DaySession[] = [];
  @Input() sessionPanel = false;
  @Input() more = false;
  @Input() loading = false;
  @Input() loadError = '';
  @Input() contextError = '';
  @Output() retryContext = new EventEmitter<void>();
  @Output() loadMore = new EventEmitter<void>();
  sessionLabel = sessionLabel;
  @Input() range?: ChartWindow;
  @Input() cursor?: number;
  private readonly changes: Subscription;
  private readonly format = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeStyle: 'medium' });
  constructor(public edit: GreenpowerEventEditService, public events: GreenpowerEventsService, public telemetry: GreenpowerTelemetryService, change: ChangeDetectorRef) {
    this.changes = edit.changed.subscribe(() => change.markForCheck());
    this.changes.add(events.changed.subscribe(() => change.markForCheck()));
    this.changes.add(telemetry.changed.subscribe(() => change.markForCheck()));
  }
  get window() { return this.range || { start: this.telemetry.start, end: this.telemetry.end }; }
  get canCapture() { return this.edit.canEditSessions && !this.telemetry.loading && !this.telemetry.more && !!this.telemetry.channels.length && !this.telemetry.error; }
  addSession() {
    const range = this.telemetry.live ? { start: this.cursor ?? this.window.end, end: this.window.end } : this.window;
    this.edit.session(true, range);
  }
  capture(boundary: 'start' | 'end') {
    if (!this.canCapture || this.cursor === undefined || !Number.isFinite(this.cursor)) return;
    this.edit.setBoundary(boundary, this.cursor);
  }
  time(value?: number | null) { return value === null ? 'Open' : value === undefined ? '—' : this.format.format(value); }
  ngOnDestroy() { this.changes.unsubscribe(); }
}
