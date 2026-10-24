import { AfterViewInit, Component, ElementRef, HostBinding, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { combineLatest, map, Observable, timer } from 'rxjs';
import { EchookConnectionService, EchookState } from './echookConnection.service';
import { dashboardMetrics, DashboardMetric } from './echookDashboard';

@Component({
  selector: 'app-echook-connection', standalone: false,
  templateUrl: './echook-connection.component.html',
  styleUrls: ['./echook-connection.component.css'],
  providers: [EchookConnectionService]
})
export class EchookConnectionComponent implements AfterViewInit, OnDestroy, OnInit {
  private readonly clockFormat = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  readonly dashboard$: Observable<EchookState & { groups: { id: string; metrics: DashboardMetric[] }[]; clock: string }>;

  constructor(public connection: EchookConnectionService, private element: ElementRef<HTMLElement>, private zone: NgZone) {
    this.dashboard$ = combineLatest([connection.state$, timer(0, 1000)]).pipe(map(([state]) => {
      const now = Date.now();
      const metrics = dashboardMetrics(state.readings, state.status === 'connected', now);
      const groups = [['speed'], ['throttle'], ['motor'], ['current'], ['left', 'right'], ['ambient', 'motor-temp']]
        .map(ids => ({ id: ids[0], metrics: ids.map(id => metrics.find(metric => metric.id === id)!) }));
      return { ...state, groups,
        clock: this.clockFormat.format(now) };
    }));
  }

  ngOnInit() { this.connection.start(); }

  @HostListener('window:pageshow')
  onPageShow() { this.connection.start(); }

  @HostBinding('style.height.px') visibleHeight?: number;
  private frame?: number;
  private observer?: ResizeObserver;
  private readonly viewport = window.visualViewport;
  private readonly resize = () => {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      const host = this.element.nativeElement;
      const bottom = Math.min(host.parentElement.getBoundingClientRect().bottom,
        window.innerHeight, this.viewport ? this.viewport.offsetTop + this.viewport.height : Infinity);
      const height = Math.max(0, Math.floor(bottom - host.getBoundingClientRect().top));
      if (height !== this.visibleHeight) this.zone.run(() => this.visibleHeight = height);
    });
  };

  ngAfterViewInit() {
    const scrollRegion = this.element.nativeElement.closest('#main_container');
    if (scrollRegion) { scrollRegion.scrollTop = 0; scrollRegion.scrollLeft = 0; }
    this.zone.runOutsideAngular(() => {
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(this.element.nativeElement.parentElement);
      this.viewport?.addEventListener('resize', this.resize);
      this.viewport?.addEventListener('scroll', this.resize);
      window.addEventListener('resize', this.resize);
      this.resize();
    });
  }

  @HostListener('window:pagehide')
  onPageHide() { void this.connection.disconnect(); }

  ngOnDestroy() {
    this.observer?.disconnect();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.viewport?.removeEventListener('resize', this.resize);
    this.viewport?.removeEventListener('scroll', this.resize);
    window.removeEventListener('resize', this.resize);
    void this.connection.disconnect();
  }
}
