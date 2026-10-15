import { SessionHistory } from './sessionHistory';

export interface SessionLap {
  number: number; start: number; end: number; duration?: number; valid?: boolean;
  complete: boolean; sectors: { index: number; time: number; valid: boolean }[];
}
// Derived incrementally from recorded trigger counters, never inferred from map geometry.
export class SessionAnalysis {
  laps: SessionLap[] = [];
  private history?: SessionHistory;
  private processed = 0;
  private lapCount = 0;
  private sectorCount = 0;
  private completeCount = 0;
  update(history: SessionHistory, channels: { id: string }[]) {
    if (this.history !== history) {
      this.history = history; this.processed = 0; this.laps = [];
      this.lapCount = this.sectorCount = this.completeCount = 0;
    }
    const index = (id: string) => channels.findIndex(c => c.id === id);
    const l = index('LapTrigger'), s = index('SectorTrigger'), c = index('LapCompleteTrigger');
    const si = index('SectorIndex'), st = index('SectorTime'), sv = index('SectorValid'), lt = index('LapTime'), lv = index('LapValid');
    for (let i = this.processed; i < history.length; i++) {
      const read = (channel: number) => channel < 0 ? NaN : history.value(i, channel);
      const lap = read(l), sector = read(s), complete = read(c);
      let current = this.laps[this.laps.length - 1];
      // Sector and completion are processed before the new-lap trigger at the finish line.
      if (Number.isFinite(sector) && sector > this.sectorCount) {
        if (current && !current.complete && Number.isFinite(read(st))) current.sectors.push({ index: read(si), time: read(st), valid: read(sv) === 1 });
        this.sectorCount = sector;
      }
      if (Number.isFinite(complete) && complete > this.completeCount) {
        if (current && !current.complete) { current.complete = true; current.duration = read(lt); current.valid = read(lv) === 1; current.end = history.time(i); }
        this.completeCount = complete;
      }
      if (Number.isFinite(lap) && lap > this.lapCount) {
        if (current && !current.complete) current.end = history.time(i);
        current = { number: lap, start: history.time(i), end: history.time(i), complete: false, sectors: [] };
        this.laps.push(current); this.lapCount = lap;
      }
      if (current && !current.complete) current.end = history.time(i);
    }
    this.processed = history.length;
  }

}
export function lapTime(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  const ms = Math.round(seconds * 1000), minutes = Math.floor(ms / 60000);
  return `${minutes}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
}
