import { Component, HostListener, OnDestroy } from '@angular/core';
import { EchookConnectionService } from './echookConnection.service';

@Component({
  selector: 'app-echook-connection', standalone: false,
  templateUrl: './echook-connection.component.html',
  styleUrls: ['./echook-connection.component.css'],
  providers: [EchookConnectionService]
})
export class EchookConnectionComponent implements OnDestroy {
  constructor(public connection: EchookConnectionService) {}

  @HostListener('window:pagehide')
  onPageHide() { void this.connection.disconnect(); }

  ngOnDestroy() { void this.connection.disconnect(); }
}
