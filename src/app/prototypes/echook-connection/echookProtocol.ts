// Reference: eChook/eChook-Arduino-Nano Globals.h and eChook_Functions.ino.
// Both legacy 0xFF zero sentinels and current zero bytes are accepted.
export interface EchookReading { id: string; label: string; unit: string; value: number; at: number; }
const channels: Record<string, [string, string]> = {
  v: ['Battery voltage', 'V'], w: ['Lower battery voltage', 'V'],
  i: ['Current', 'A'], m: ['Motor speed', 'rpm'], s: ['Vehicle speed', 'm/s'],
  t: ['Throttle input', '%'], d: ['Throttle output', '%'], T: ['Throttle voltage', 'V'],
  a: ['Temperature 1', '°C'], b: ['Temperature 2', '°C'], c: ['Internal temperature', '°C'],
  L: ['Launch button', ''], C: ['Display button', ''], r: ['Gear ratio', ''],
  B: ['Brake', ''], V: ['Reference voltage', 'V']
};

export class EchookDecoder {
  private pending: number[] = [];
  reset() { this.pending = []; }

  // Retains at most four incomplete bytes, regardless of stream duration.
  push(bytes: Uint8Array, at: number, receive: (reading: EchookReading) => void) {
    for (const byte of bytes) {
      if (!this.pending.length && byte !== 123) continue;
      this.pending.push(byte);
      if (this.pending.length < 5) continue;
      const [, identifier, first, second, end] = this.pending;
      const low = second === 255 ? 0 : second;
      const high = first === 255 ? 0 : first;
      if (end === 125 && identifier >= 33 && identifier <= 126 && low <= 99) {
        const id = String.fromCharCode(identifier);
        const [label, unit] = channels[id] || [`Channel ${id}`, ''];
        receive({ id, label, unit, value: high < 128 ? high + low / 100 : (high - 128) * 100 + low, at });
        this.pending = [];
      } else {
        this.pending.shift();
        while (this.pending.length && this.pending[0] !== 123) this.pending.shift();
      }
    }
  }
}
