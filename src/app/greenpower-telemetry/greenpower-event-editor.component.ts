import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChartWindow } from './greenpowerChart';
import { GreenpowerEventEditService } from './greenpowerEventEdit.service';
import { GreenpowerEventsService } from './greenpowerEvents.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';

@Component({ selector: 'app-greenpower-event-editor', standalone: false,
  templateUrl: './greenpower-event-editor.component.html', styleUrls: ['./greenpower-event-editor.component.css'] })
export class GreenpowerEventEditorComponent implements OnDestroy {
  @Input() range?: ChartWindow;
  @Output() daySelect = new EventEmitter<string>();
  @ViewChild('confirmSave') set confirmSave(button: ElementRef<HTMLButtonElement> | undefined) { button?.nativeElement.focus(); }
  private readonly changes: Subscription;
  private recordedDates = '';
  private readonly format = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'medium' });
  constructor(public edit: GreenpowerEventEditService, public events: GreenpowerEventsService, public telemetry: GreenpowerTelemetryService, change: ChangeDetectorRef) {
    const loadNames = () => {
      const dates = edit.mode === 'session' ? this.days.join(',') : '';
      if (dates !== this.recordedDates) { this.recordedDates = dates; if (dates) void events.loadDayNames(this.days); }
    };
    this.changes = edit.changed.subscribe(() => { loadNames(); change.markForCheck(); });
    this.changes.add(events.changed.subscribe(() => change.markForCheck()));
    this.changes.add(telemetry.changed.subscribe(() => { loadNames(); change.markForCheck(); }));
    loadNames();
  }
  get window() { return this.range || { start: this.telemetry.start, end: this.telemetry.end }; }
  get canCapture() { return !this.telemetry.live && !this.telemetry.loading && !this.telemetry.more && !!this.telemetry.channels.length && !this.telemetry.error; }
  get days() { return this.canCapture && !this.telemetry.dates.includes(this.telemetry.day) ? [this.telemetry.day, ...this.telemetry.dates] : this.telemetry.dates; }
  get targets() {
    const source = this.edit.sourceEvent;
    return [...(source && !this.events.events.some(event => event.id === source.id) ? [source] : []), ...this.events.events].filter(event => event.state === 'active');
  }
  time(value?: number) { return value === undefined ? '—' : this.format.format(value); }
  reopen() {
    if (this.edit.draft.state === 'superseded') { this.edit.draft.state = 'active'; delete this.edit.draft.supersededBy; }
  }
  ngOnDestroy() { this.changes.unsubscribe(); }
}
