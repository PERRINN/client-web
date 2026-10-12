import { Component } from '@angular/core';

@Component({
  selector: 'app-dil-workflow', standalone: false,
  templateUrl: './dil-workflow.component.html', styleUrls: ['./dil-workflow.component.css']
})
export class DilWorkflowComponent {
  selected = 1;
  readonly steps = [
    { title: 'Reference lap', status: 'Demonstrated on 424', detail: 'A representative driver lap becomes the reference dataset.', input: 'Driver + 424 DIL simulator', output: 'Time-stamped steering, throttle, brake, vehicle states, track position and the surface beneath FL / FR / RL / RR.' },
    { title: 'Executable replay', status: 'Demonstrated on 424', detail: 'An external executable runs Edy’s VPP with the recorded inputs and wheel surfaces.', input: 'Recorded inputs + surfaces + reference trajectory', output: 'Vehicle response + telemetry + position-correction history. No new driver decisions are introduced.' },
    { title: 'Setup variations', status: 'Comparisons demonstrated · orchestration to automate', detail: 'Change a setup parameter and repeat the reference conditions to isolate its effect.', input: 'Baseline setup + spring / damper / differential / aero variation', output: 'Matched baseline and modified runs, with setup provenance. Automated job scheduling and sweeps are still to build.' },
    { title: 'Telemetry analysis', status: 'Comparisons demonstrated · reporting to automate', detail: 'Align runs by track distance and inspect each corner, rather than relying on a single lap-time number.', input: 'Matched runs + corner windows + correction diagnostics', output: 'Overlays, delta traces, sensitivity curves and trade-off summaries. Automated analysis and reporting are still to build.' },
    { title: 'Engineering decisions', status: 'Engineer-led', detail: 'Use sensitivity evidence to shortlist setups and design directions for validation.', input: 'Performance changes + compromises + replay validity', output: 'A testable engineering recommendation, checked against driver feedback and further simulation or track testing.' }
  ];
  get current() { return this.steps[this.selected]; }
}
