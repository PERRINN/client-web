import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { GreenpowerChannel, londonDay, londonTime } from './greenpowerData';
import { ChartWindow } from './greenpowerChart';
import { ChannelDrag } from './channelDrag';
import { orderFor, ViewKind } from './greenpowerView';
import { GreenpowerViewService } from './greenpowerView.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';

@Component({
  selector: 'app-greenpower-telemetry', standalone: false,
  templateUrl: './greenpower-telemetry.component.html', styleUrls: ['./greenpower-telemetry.component.css'],
  providers: [GreenpowerTelemetryService, GreenpowerViewService]
})
export class GreenpowerTelemetryComponent implements OnDestroy {
  historyOpen = false;
  scalars: GreenpowerChannel[] = [];
  charts: GreenpowerChannel[] = [];
  available: GreenpowerChannel[] = [];
  editorKind: ViewKind = 'scalars';
  selectedCount = 0;
  orderNotice = '';
  readonly drag: ChannelDrag;
  private dragKind: ViewKind = 'scalars';
  @ViewChild('channelOptions') private channelOptions?: ElementRef<HTMLElement>;
  window?: ChartWindow;
  cursor?: number;
  private context = '';
  get start() { return this.window?.start ?? this.telemetry.start; }
  get end() { return this.window?.end ?? this.telemetry.end; }
  zoom(window?: ChartWindow) { this.window = window; this.cursor = undefined; }
  now = Date.now();
  time = londonTime;
  private readonly previousTitle: string;
  private readonly changes: Subscription;
  private readonly clock: ReturnType<typeof setInterval>;
  constructor(public telemetry: GreenpowerTelemetryService, change: ChangeDetectorRef, private title: Title, public view: GreenpowerViewService) {
    this.drag = new ChannelDrag({
      valid: () => view.editing && view.canEdit && !view.saving && this.editorKind === this.dragKind,
      reorder: (id, index) => view.reorder(this.dragKind, id, index),
      restore: order => view.restoreOrder(this.dragKind, order),
      changed: () => change.markForCheck(), announce: message => this.orderNotice = message
    });
    this.context = telemetry.day + ':' + telemetry.live + ':' + telemetry.access;
    this.previousTitle = title.getTitle(); title.setTitle('424 Greenpower Telemetry · PERRINN');
    this.changes = telemetry.changed.subscribe(() => {
      const context = telemetry.day + ':' + telemetry.live + ':' + telemetry.access;
      if (this.context !== context || !telemetry.channels.length) { this.zoom(); this.context = context; }
      this.refreshView(); change.markForCheck();
    });
    this.changes.add(view.changed.subscribe(() => { this.refreshView(); change.markForCheck(); }));
    this.refreshView();
    this.clock = setInterval(() => { this.now = Date.now(); telemetry.tick(); change.markForCheck(); }, 1000);
  }
  private refreshView() {
    if ((!this.view.editing || !this.view.canEdit || this.view.saving) && this.drag.pending) this.drag.cancel();
    if (!this.view.editing) this.orderNotice = '';
    this.selectedCount = Object.keys(this.view.draft[this.editorKind]).length;
    this.scalars = this.view.scalars(this.telemetry.channels);
    this.charts = this.view.charts(this.telemetry.channels);
    this.available = this.view.editing ? this.view.available(this.telemetry.channels, this.editorKind) : [];
  }
  selectEditor(kind: ViewKind) {
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
    if (!data.live) return 'History · UK time';
    if (data.loading && !data.latest) return 'Loading';
    if (!data.connected) return navigator.onLine ? 'Reconnecting' : 'Offline';
    if (!data.latest) return 'Waiting for telemetry';
    return this.now - data.latest.receivedAt > 15000 ? 'Stale' : 'Live';
  }
  async history() {
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen && !this.telemetry.dates.length) await this.telemetry.loadDates();
  }
  live() { this.historyOpen = false; void this.telemetry.select(londonDay(), true); }
  ngOnDestroy() { this.changes.unsubscribe(); this.drag.cancel(); clearInterval(this.clock); this.title.setTitle(this.previousTitle); }
}
