import { Component, HostListener, OnDestroy } from '@angular/core';
import { combineLatest, map, Observable, timer } from 'rxjs';
import { EchookConnectionService, EchookState } from './echookConnection.service';
import { dashboardMetrics, DashboardMetric } from './echookDashboard';

@Component({
  selector: 'app-echook-connection', standalone: false,
  templateUrl: './echook-connection.component.html',
  styleUrls: ['./echook-connection.component.css'],
  providers: [EchookConnectionService]
})
export class EchookConnectionComponent implements OnDestroy {
  private readonly clockFormat = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  readonly dashboard$: Observable<EchookState & { metrics: DashboardMetric[]; clock: string }>;

  constructor(public connection: EchookConnectionService) {
    this.dashboard$ = combineLatest([connection.state$, timer(0, 1000)]).pipe(map(([state]) => {
      const now = Date.now();
      return { ...state, metrics: dashboardMetrics(state.readings, state.status === 'connected', now),
        clock: this.clockFormat.format(now) };
    }));
  }

  @HostListener('window:pagehide')
  onPageHide() { void this.connection.disconnect(); }

  ngOnDestroy() { void this.connection.disconnect(); }
}
