import { readFileSync } from 'node:fs';
import ts from 'typescript';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

export function load(relative, imports = {}) {
  const code = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  });
  return exports;
}
export const data = load('../../src/app/greenpower-telemetry/greenpowerData.ts');
export const eventData = load('../../src/app/greenpower-telemetry/greenpowerEvents.ts');
export const recordings = load('../../src/app/greenpower-telemetry/greenpowerRecording.ts', {
  'firebase/compat/app': { default: firebase }, 'firebase/compat/firestore': {}, './greenpowerData': data, './greenpowerEvents': eventData
});
export const sample = (index, receivedAt = Date.UTC(2026, 9, 19) + index * 3000) => ({
  id: String(index), source: 'synthetic', receivedAt,
  raw: JSON.stringify({ Vt: 24 + Math.sin(index / 60), A: 30 + Math.cos(index / 30) * 5, Spd: 10 + Math.sin(index / 20), Tmp1: 30 + index / 1000, Lat: 52, Lon: -1, custom: { value: index % 10, unit: 'widgets' }, status: 'running' })
});

export const dayData = load('../../src/app/greenpower-telemetry/greenpowerDay.ts', { './greenpowerEvents': eventData });
export const gps = load('../../src/app/greenpower-telemetry/greenpowerGps.ts', { './greenpowerData': data });
export const tracks = load('../../src/app/greenpower-telemetry/greenpowerTracks.ts', { './greenpowerGps': gps });

export const lapMetrics = load('../../src/app/greenpower-telemetry/greenpowerLapMetrics.ts', { './greenpowerData': data });

export const motorSpeed = load('../../src/app/greenpower-telemetry/greenpowerSpeed.ts', { './greenpowerData': data, './greenpowerDay': dayData, './greenpowerGps': gps });
