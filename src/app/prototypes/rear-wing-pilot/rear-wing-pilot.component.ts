import { Component } from '@angular/core';
import { rearWingBrief, strengthLoads } from './rearWingBrief';
import { RearWingExportService } from './rearWingExport.service';

@Component({
  selector: 'app-rear-wing-pilot',
  standalone: false,
  templateUrl: './rear-wing-pilot.component.html',
  styleUrls: ['./rear-wing-pilot.component.css'],
  providers: [RearWingExportService]
})
export class RearWingPilotComponent {
  readonly brief = rearWingBrief;
  readonly strength = strengthLoads();
  error = '';
  constructor(private exports: RearWingExportService) {}
  download(kind: 'markdown' | 'json'): void {
    try { this.exports.download(kind); this.error = ''; }
    catch { this.error = 'Could not download the brief. Please try again.'; }
  }
}
