import { Component, OnDestroy } from '@angular/core';
import { DilAnalysisService, DilRun } from './dilAnalysis.service';
import { DilSeries } from './dil-chart.component';

@Component({
  selector: 'app-dil-sensitivity-analysis', standalone: false,
  templateUrl: './dil-sensitivity-analysis.component.html',
  styleUrls: ['./dil-sensitivity-analysis.component.css'], providers: [DilAnalysisService]
})
export class DilSensitivityAnalysisComponent implements OnDestroy {
  cornerIndex = 1;
  setupIndex = 0;
  cursor = 30;
  run: DilRun;
  distances: number[] = [];
  speedSeries: DilSeries[] = [];
  deltaSeries: DilSeries[] = [];
  loadSeries: DilSeries[] = [];
  sensitivity: DilSeries[] = [];
  readonly variations = [-20, -10, 0, 10, 20];
  sweep: DilRun[] = [];
  state: 'idle' | 'running' | 'complete' | 'error' = 'idle';
  simulateFailure = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(public analysis: DilAnalysisService) {
    this.run = analysis.compare(this.cornerIndex, this.setupIndex);
    this.update();
  }
  update() {
    this.run = this.analysis.compare(this.cornerIndex, this.setupIndex);
    this.distances = this.run.samples.map(sample => sample.distance);
    this.speedSeries = [
      { name: 'Baseline', values: this.run.samples.map(sample => sample.speed) },
      { name: 'Modified', values: this.run.samples.map(sample => sample.modifiedSpeed) }
    ];
    this.deltaSeries = [{ name: 'Modified − baseline', values: this.run.samples.map(sample => sample.delta) }];
    this.loadSeries = [
      { name: 'Baseline', values: this.run.samples.map(sample => sample.load) },
      { name: 'Modified', values: this.run.samples.map(sample => sample.modifiedLoad) }
    ];
    this.sensitivity = [{ name: 'Corner time delta', values: this.variations.map(value => this.analysis.compare(this.cornerIndex, this.setupIndex, value).delta) }];
    this.sweep = [];
    this.state = 'idle';
  }
  runSweep() {
    this.state = 'running';
    this.sweep = [];
    this.timer = setTimeout(() => {
      if (this.simulateFailure) { this.state = 'error'; return; }
      this.sweep = this.analysis.setups.map((_, index) => this.analysis.compare(this.cornerIndex, index)).sort((a, b) => a.delta - b.delta);
      this.state = 'complete';
    }, 650);
  }
  ngOnDestroy() { clearTimeout(this.timer); }
}
