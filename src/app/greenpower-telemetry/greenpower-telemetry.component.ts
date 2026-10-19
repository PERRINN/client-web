import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { GreenpowerChannel, VOLTAGE_LEFT, VOLTAGE_RIGHT, londonDay, londonTime, sampleTime } from './greenpowerData';
import { ChartWindow, scalarValue } from './greenpowerChart';
import { LapInterval } from './greenpowerLaps';
import { GreenpowerLapService } from './greenpowerLap.service';
import { FinishLine } from './greenpowerGps';
import { GreenpowerMapComponent } from './greenpower-map.component';
import { ChannelDrag } from './channelDrag';
import { orderFor, ViewKind } from './greenpowerView';
import { GreenpowerViewService } from './greenpowerView.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';
import { GreenpowerEventsService } from './greenpowerEvents.service';
import { GreenpowerEventEditService } from './greenpowerEventEdit.service';

@Component({
  selector: 'app-greenpower-telemetry', standalone: false,
  templateUrl: './greenpower-telemetry.component.html', styleUrls: ['./greenpower-telemetry.component.css'],
  providers: [GreenpowerTelemetryService, GreenpowerViewService, GreenpowerLapService, GreenpowerEventsService, GreenpowerEventEditService]
})
export class GreenpowerTelemetryComponent implements OnDestroy {
  @ViewChild(GreenpowerMapComponent) private map?: GreenpowerMapComponent;
  channels: GreenpowerChannel[] = [];
  historyOpen = false;
  activeView: 'data' | 'track' | 'laps' = 'data';
  editorPanel: 'view' | 'event' = 'view';
  metadataEditing = false;
  private recordingRevision = 0;
  get heading() { return this.events.selectedEvent?.name || '424 Greenpower Telemetry'; }
  get dateLabel() {
    const last = this.events.selectedSession?.segments.at(-1)?.day;
    return last && last !== this.telemetry.day ? this.telemetry.day + ' – ' + last : this.telemetry.day;
  }
  get editing() { return this.view.editing || this.metadataEditing; }
  get dataset() { return this.telemetry.day + ':' + this.telemetry.live + ':' + this.telemetry.recordingKey; }
  scalars: GreenpowerChannel[] = [];
  charts: GreenpowerChannel[] = [];
  readonly voltageLeftId = VOLTAGE_LEFT;
  voltageRight?: GreenpowerChannel;
  laps: LapInterval[] = [];
  available: GreenpowerChannel[] = [];
  editorKind: ViewKind = 'scalars';
  selectedCount = 0;
  orderNotice = '';
  readonly drag: ChannelDrag;
  private dragKind: ViewKind = 'scalars';
  @ViewChild('channelOptions') private channelOptions?: ElementRef<HTMLElement>;
  window?: ChartWindow;
  cursor?: number;
  scalarValue = scalarValue;
  private context = '';
  get start() { return this.window?.start ?? this.telemetry.start; }
  get end() { return this.window?.end ?? this.telemetry.end; }
  selectView(view: 'data' | 'track' | 'laps') { this.drag.cancel(); this.activeView = view; }
  selectLap(window: ChartWindow) { this.zoom(window); this.selectView('data'); }
  zoom(window?: ChartWindow) { this.window = window; this.cursor = undefined; }
  now = Date.now();
  time = londonTime;
  sampleTime = sampleTime;
  private readonly previousTitle: string;
  private readonly changes: Subscription;
  private readonly clock: ReturnType<typeof setInterval>;
  constructor(public telemetry: GreenpowerTelemetryService, change: ChangeDetectorRef, private title: Title, public view: GreenpowerViewService, public lapConfig: GreenpowerLapService, public events: GreenpowerEventsService, public eventEdit: GreenpowerEventEditService) {
    this.drag = new ChannelDrag({
      valid: () => this.activeView === 'data' && this.editorPanel === 'view' && view.editing && view.canEdit && !view.saving && this.editorKind === this.dragKind,
      reorder: (id, index) => view.reorder(this.dragKind, id, index),
      restore: order => view.restoreOrder(this.dragKind, order),
      changed: () => change.markForCheck(), announce: message => this.orderNotice = message
    });
    this.context = this.dataset + ':' + telemetry.access;
    this.previousTitle = title.getTitle(); title.setTitle('424 Greenpower Telemetry · PERRINN');
    this.changes = telemetry.changed.subscribe(() => {
      const context = this.dataset + ':' + telemetry.access;
      if (this.context !== context || !telemetry.channels.length) { this.zoom(); this.context = context; }
      this.refreshView(); change.markForCheck();
    });
    this.changes.add(view.changed.subscribe(() => { this.refreshView(); change.markForCheck(); }));
    this.changes.add(lapConfig.changed.subscribe(() => { this.refreshView(); change.markForCheck(); }));
    this.changes.add(events.changed.subscribe(() => {
      if (!events.canEdit) { this.metadataEditing = false; this.eventEdit.cancel(); }
      if (events.selectedEvent && !events.sessionId && telemetry.recordingKey === 'event:' + events.eventId && telemetry.day !== events.selectedEvent.date) telemetry.clearRecording(events.selectedEvent.date, telemetry.recordingKey);
      this.title.setTitle(this.heading + ' · PERRINN'); change.markForCheck();
    }));
    this.changes.add(eventEdit.changed.subscribe(() => change.markForCheck()));
    this.changes.add(events.recordingChanged.subscribe(session => {
      if (session) void telemetry.selectRecording(session.id + ':' + ++this.recordingRevision, session.segments);
      else telemetry.clearRecording(events.selectedEvent?.date, events.eventId ? 'event:' + events.eventId : '');
    }));
    this.refreshView();
    this.clock = setInterval(() => { this.now = Date.now(); telemetry.tick(); change.markForCheck(); }, 1000);
  }
  private refreshView() {
    if ((!this.view.editing || !this.view.canEdit || this.view.saving) && this.drag.pending) this.drag.cancel();
    if (!this.view.editing) this.orderNotice = '';
    this.selectedCount = Object.keys(this.view.draft[this.editorKind]).length;
    this.lapConfig.select(this.dataset);
    this.lapConfig.syncEditing(this.view.editing);
    this.lapConfig.update(this.telemetry.channels, this.telemetry.end);
    this.channels = [...this.telemetry.channels, this.lapConfig.analysis.channel];
    this.voltageRight = this.channels.find(channel => channel.id === VOLTAGE_RIGHT);
    this.scalars = this.view.scalars(this.channels);
    this.charts = this.view.charts(this.channels);
    this.laps = this.lapConfig.analysis.laps;
    this.available = this.view.editing ? this.view.available(this.channels, this.editorKind) : [];
  }
  saveView() { void this.view.save(this.lapConfig.selectionWrite()); }
  toggleEditing() {
    if (this.activeView === 'laps' || this.eventEdit.locked || this.view.saving) return;
    if (this.editing) { this.view.cancel(); this.eventEdit.cancel(); this.metadataEditing = false; }
    else {
      if (this.view.canEdit) this.view.edit(this.channels);
      else { this.metadataEditing = true; this.editorPanel = 'event'; }
    }
  }
  eventPanel() {
    this.drag.cancel(); this.editorPanel = 'event';
    if (!this.events.loadedEvents && !this.events.loadingEvents) void this.events.loadEvents();
  }
  selectDay(day: string) { if (!this.eventEdit.locked) { this.events.clear(); void this.telemetry.select(day); } }
  retryRecording() {
    const session = this.events.selectedSession;
    if (session && this.telemetry.recordingKey) void this.telemetry.selectRecording(session.id + ':' + ++this.recordingRevision, session.segments);
    else void this.telemetry.select(this.telemetry.day, this.telemetry.live);
  }
  selectTrack(id: string) {
    if (id === 'more') this.lapConfig.loadMore();
    else this.lapConfig.choose(id);
  }
  async saveFinish(value: { line: FinishLine | null; revision: number; name: string }) {
    if (await this.lapConfig.save(value.line, value.revision, value.name)) this.map?.confirmSaved(value.line, this.lapConfig.revision, this.lapConfig.name);
  }
  selectEditor(kind: ViewKind) {
    this.editorPanel = 'view';
    this.drag.cancel();
    this.editorKind = kind; this.orderNotice = ''; this.refreshView();
    if (this.channelOptions) this.channelOptions.nativeElement.scrollTop = 0;
  }
  moveChannel(channel: GreenpowerChannel, direction: -1 | 1) {
    this.view.move(this.editorKind, channel.id, direction);
    this.orderNotice = channel.label + ', position ' + (this.available.findIndex(c => c.id === channel.id) + 1) + ' of ' + this.selectedCount;
  }
  startDrag(event: PointerEvent, channel: GreenpowerChannel, list: HTMLElement) {
    this.dragKind = this.editorKind;
    this.drag.start(event, list, channel.id, channel.label + (channel.unit ? ' · ' + channel.unit : ''), orderFor(this.view.draft, this.editorKind));
  }
  handleKey(event: KeyboardEvent, channel: GreenpowerChannel) {
    if (event.key === 'Escape') { event.preventDefault(); this.drag.cancel(); }
    else if (!this.drag.pending && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault(); this.moveChannel(channel, event.key === 'ArrowUp' ? -1 : 1);
    }
  }
  @HostListener('window:keydown.escape', ['$event']) escapeDrag(event: KeyboardEvent) {
    if (this.drag.pending) { event.preventDefault(); this.drag.cancel(); }
  }
  @HostListener('window:blur') cancelDrag() { this.drag.cancel(); }
  @HostListener('document:visibilitychange') visibilityChanged() { if (document.hidden) this.drag.cancel(); }
  get status() {
    const data = this.telemetry;
    if (!data.live) return this.events.selectedSession?.metadataStatus === 'review_needed' || this.events.selectedEvent?.metadataStatus === 'review_needed' ? 'Needs review · UK time' : 'History · UK time';
    if (data.loading && !data.latest) return 'Loading';
    if (!data.connected) return navigator.onLine ? 'Reconnecting' : 'Offline';
    if (!data.latest) return 'Waiting for telemetry';
    return this.now - data.latest.receivedAt > 15000 ? 'Stale' : 'Live';
  }
  async history() {
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen && !this.telemetry.dates.length) await this.telemetry.loadDates();
  }
  live() { if (!this.eventEdit.locked) { this.events.clear(); this.historyOpen = false; void this.telemetry.select(londonDay(), true); } }
  ngOnDestroy() { this.changes.unsubscribe(); this.drag.cancel(); clearInterval(this.clock); this.title.setTitle(this.previousTitle); }
}
