import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { GreenpowerChannel, VOLTAGE_LEFT, VOLTAGE_RIGHT, londonDay } from './greenpowerData';
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
import { DaySession, RecordedEvent } from './greenpowerDay';
import { recordingHeader } from './greenpowerContext';

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
  private loadedEvent?: RecordedEvent;
  private loadedSession?: DaySession;
  get header() {
    const data = this.telemetry;
    return recordingHeader({ signedIn: data.access === 'signed-in', live: data.live, day: data.day,
      loading: data.loading, partial: data.more, error: !!data.error, hasSamples: !!data.latest && !!data.channels.length,
      start: data.start, end: data.end, lastReceived: data.latest?.receivedAt, liveStatus: this.liveStatus,
      event: this.loadedEvent, session: this.loadedSession });
  }
  get heading() { return this.header.title; }
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
      if (telemetry.access !== 'signed-in') { this.loadedEvent = undefined; this.loadedSession = undefined; }
      const context = this.dataset + ':' + telemetry.access;
      if (this.context !== context || !telemetry.channels.length) { this.zoom(); this.context = context; }
      this.refreshView(); this.syncHeader(); change.markForCheck();
    });
    this.changes.add(view.changed.subscribe(() => { this.refreshView(); change.markForCheck(); }));
    this.changes.add(lapConfig.changed.subscribe(() => { this.refreshView(); change.markForCheck(); }));
    this.changes.add(events.changed.subscribe(() => {
      if (!events.canEdit) { this.metadataEditing = false; this.eventEdit.cancel(); }
      this.syncHeader(); change.markForCheck();
    }));
    this.changes.add(eventEdit.changed.subscribe(() => change.markForCheck()));

    this.refreshView();
    this.syncHeader();
    this.clock = setInterval(() => { this.now = Date.now(); telemetry.tick(); change.markForCheck(); }, 1000);
  }
  private syncHeader() {
    const title = this.heading + ' · PERRINN';
    if (this.title.getTitle() !== title) this.title.setTitle(title);
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
  loadSelectedRecording() {
    if (!this.events.eventReady || !this.events.selectedEvent || this.events.sessionId && !this.events.sessionReady || this.eventEdit.locked || this.telemetry.loading) return;
    this.loadedEvent = JSON.parse(JSON.stringify(this.events.selectedEvent));
    this.loadedSession = this.events.selectedSession ? JSON.parse(JSON.stringify(this.events.selectedSession)) : undefined;
    this.fetchLoadedRecording();
  }
  private fetchLoadedRecording() {
    const event = this.loadedEvent, session = this.loadedSession;
    if (!event) return;
    if (session) void this.telemetry.selectRecording(session.id + ':' + ++this.recordingRevision, session.ranges);
    else void this.telemetry.select(event.date);
  }
  retryRecording() {
    if (this.telemetry.live) void this.telemetry.select(londonDay(), true);
    else this.fetchLoadedRecording();
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
  private get liveStatus() {
    const data = this.telemetry;
    if (data.loading && !data.channels.length) return 'Loading';
    if (!data.connected) return navigator.onLine ? 'Reconnecting' : 'Offline';
    if (!data.latest) return 'Waiting for telemetry';
    return this.now - data.latest.receivedAt > 15000 ? 'Stale' : 'Live';
  }
  async history() {
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen && !this.events.loadedEvents && !this.events.loadingEvents) await this.events.loadEvents();
  }
  live() { if (!this.eventEdit.locked) { this.loadedEvent = undefined; this.loadedSession = undefined; this.historyOpen = false; void this.telemetry.select(londonDay(), true); } }
  ngOnDestroy() { this.changes.unsubscribe(); this.drag.cancel(); clearInterval(this.clock); this.title.setTitle(this.previousTitle); }
}
