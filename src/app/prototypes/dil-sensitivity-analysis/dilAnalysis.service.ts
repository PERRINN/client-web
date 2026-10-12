import { Injectable } from '@angular/core';

export interface DilCorner { name: string; length: number; speed: number; severity: number; }
export interface DilSetup { name: string; parameter: string; effect: number; tradeoff: string; }
export interface DilSample { distance: number; speed: number; modifiedSpeed: number; delta: number; load: number; modifiedLoad: number; correction: number; }
export interface DilRun { setup: DilSetup; samples: DilSample[]; delta: number; loadChange: number; maxCorrection: number; }

@Injectable()
export class DilAnalysisService {
  readonly corners: DilCorner[] = [
    { name: 'Slow hairpin', length: 320, speed: 115, severity: 55 },
    { name: 'Medium-speed corner', length: 500, speed: 175, severity: 60 },
    { name: 'Fast sweep', length: 700, speed: 240, severity: 45 }
  ];
  readonly setups: DilSetup[] = [
    { name: 'Softer front springs', parameter: 'Front spring rate −10%', effect: 1.8, tradeoff: 'More compliance through the apex; greater platform movement can reduce aero consistency at speed.' },
    { name: 'More rebound damping', parameter: 'Rear rebound damping +10%', effect: 1.1, tradeoff: 'A calmer transition in this example; repeated bumps may compromise tyre contact and recovery.' },
    { name: 'Less differential locking', parameter: 'Power differential locking −10%', effect: 1.5, tradeoff: 'Improved rotation in the slow corner; check inside-wheel slip and traction on exit.' },
    { name: 'More rear downforce', parameter: 'Rear aero load +10%', effect: 2.2, tradeoff: 'More support in the fast sweep; additional drag and aero balance changes require a full-lap check.' }
  ];

  // Illustrative signal generator, not a vehicle model. Integrate time from speed
  // over equal distance intervals so the delta trace and result agree.
  compare(cornerIndex: number, setupIndex: number, variation = 10): DilRun {
    const corner = this.corners[cornerIndex];
    const setup = this.setups[setupIndex];
    const suitability = [[1, .6, 1.2, .25], [.8, 1, .7, .7], [.25, .6, .3, 1.4]][cornerIndex][setupIndex];
    const gain = setup.effect * suitability * variation / 10;
    let delta = 0;
    const samples: DilSample[] = [];
    for (let i = 0; i <= 60; i++) {
      const phase = i / 60;
      const apex = Math.sin(Math.PI * phase) ** 2;
      const speed = corner.speed - corner.severity * apex + 6 * phase;
      const modifiedSpeed = speed + gain * apex - Math.max(0, gain) * .18 * phase;
      if (i > 0) {
        const previous = samples[i - 1];
        delta += corner.length / 60 * 3.6 * ((1 / previous.modifiedSpeed + 1 / modifiedSpeed) / 2 - (1 / previous.speed + 1 / speed) / 2);
      }
      const load = 3.4 + apex * 2 + .18 * Math.sin(phase * Math.PI * 8);
      samples.push({ distance: phase * corner.length, speed, modifiedSpeed, delta, load,
        modifiedLoad: load + gain * .06 * Math.sin(phase * Math.PI * 3),
        correction: .015 + Math.abs(gain) * .004 * apex });
    }
    return { setup, samples, delta, loadChange: Math.max(...samples.map(sample => Math.abs(sample.modifiedLoad - sample.load) / sample.load * 100)), maxCorrection: Math.max(...samples.map(sample => sample.correction)) };
  }
}
