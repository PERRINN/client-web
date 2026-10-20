import { ChangeDetectorRef, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { DAY_SESSION_TYPES } from './greenpowerDay';
import { ChartWindow } from './greenpowerChart';
import { GreenpowerEventEditService } from './greenpowerEventEdit.service';
import { GreenpowerEventsService } from './greenpowerEvents.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';

@Component({ selector: 'app-greenpower-event-editor', standalone: false,
  templateUrl: './greenpower-event-editor.component.html', styleUrls: ['./greenpower-event-editor.component.css'] })
export class GreenpowerEventEditorComponent implements OnDestroy {
  @Input() range?: ChartWindow;
  @Input() cursor?: number;
  @ViewChild('confirmSave') set confirmSave(button: ElementRef<HTMLButtonElement> | undefined) { button?.nativeElement.focus(); }
  private readonly changes: Subscription;
  private readonly format = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'medium' });
  constructor(public edit: GreenpowerEventEditService, public events: GreenpowerEventsService, public telemetry: GreenpowerTelemetryService, change: ChangeDetectorRef) {
    this.changes = edit.changed.subscribe(() => {
      const session = edit.sessionDraft;
      if (session && (this.sessionId !== session.id || this.bounds !== session.startAt + ':' + session.endAt)) {
        this.sessionId = session.id;
        this.bounds = session.startAt + ':' + session.endAt;
        this.startTime = this.clockTime(session.startAt); this.endTime = this.clockTime(session.endAt);
      } else if (!session) this.sessionId = '';
      change.markForCheck();
    });
    this.changes.add(events.changed.subscribe(() => change.markForCheck()));
    this.changes.add(telemetry.changed.subscribe(() => change.markForCheck()));
  }
  get window() { return this.range || { start: this.telemetry.start, end: this.telemetry.end }; }
  get canCapture() { return this.events.eventReady && this.telemetry.day === this.events.selectedEvent?.date && !this.telemetry.live && !this.telemetry.loading && !this.telemetry.more && !!this.telemetry.channels.length && !this.telemetry.error; }
  get sessionType() { return DAY_SESSION_TYPES.find(type => type.id === this.edit.sessionDraft?.type)?.label || ''; }
  private sessionId = '';
  private bounds = '';
  private clockTime(value: number) { return value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(value) : ''; }
  startTime = '';
  endTime = '';
  useTimes() {
    const parse = (time: string) => {
      if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) return NaN;
      const [hour, minute, second = 0] = time.split(':').map(Number);
      if (hour > 23 || minute > 59 || second > 59) return NaN;
      const date = this.edit.sourceEvent?.date;
      if (!date) return NaN;
      const utc = Date.parse(date + 'T' + time + (time.length === 5 ? ':00' : '') + 'Z');
      const format = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' });
      const candidates = [utc - 3600000, utc].filter(value => Number(format.format(value)) === hour);
      return candidates.length === 1 ? candidates[0] : NaN;
    };
    const start = parse(this.startTime), end = parse(this.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) { this.edit.error = 'Enter valid UK times. For ambiguous clock changes, use the cursor.'; return; }
    this.edit.replaceRange({ start, end });
  }
  capture(boundary: 'start' | 'end') {
    if (!this.canCapture || this.cursor === undefined || !Number.isFinite(this.cursor)) return;
    this.edit.setBoundary(boundary, this.cursor);
  }
  time(value?: number) { return value === undefined ? '—' : this.format.format(value); }
  ngOnDestroy() { this.changes.unsubscribe(); }
}
