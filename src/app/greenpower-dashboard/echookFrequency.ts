// Bounded rolling arrival counts: eight input channels, 51 x 100 ms buckets each.
// Count decoded packets, including repeated values and packets in the same read.
const CHANNELS = new Set(['s', 'v', 'w', 't', 'm', 'i', 'a', 'b']);
export class EchookFrequency {
  private channels = new Map<string, { start: number; buckets: { tick: number; count: number }[] }>();

  record(id: string, now: number) {
    if (!CHANNELS.has(id)) return;
    let channel = this.channels.get(id);
    if (!channel) {
      channel = { start: now, buckets: Array.from({ length: 51 }, () => ({ tick: -Infinity, count: 0 })) };
      this.channels.set(id, channel);
    }
    const tick = Math.floor(now / 100), bucket = channel.buckets[tick % 51];
    if (bucket.tick !== tick) { bucket.tick = tick; bucket.count = 0; }
    bucket.count++;
  }

  snapshot(now: number): Record<string, number> {
    const rates: Record<string, number> = {};
    for (const [id, channel] of this.channels) {
      const elapsed = now - channel.start;
      if (elapsed < 1000) continue;
      const cutoff = Math.floor((now - 5000) / 100);
      const count = channel.buckets.reduce((sum, bucket) => sum + (bucket.tick > cutoff ? bucket.count : 0), 0);
      // The first arrival starts the observation interval, rather than completing one.
      rates[id] = Math.max(0, count - (elapsed < 5000 ? 1 : 0)) / (Math.min(elapsed, 5000) / 1000);
    }
    return rates;
  }
}
