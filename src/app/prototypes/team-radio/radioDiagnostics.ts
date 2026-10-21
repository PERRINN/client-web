export interface RadioDiagnosticDetails {
  seat?: string;
  session?: string;
  peerSeat?: string;
  peerSession?: string;
  offerId?: string;
  kind?: string;
  reason?: string;
  connection?: string;
  ice?: string;
  gathering?: string;
  signaling?: string;
}

/** Local, bounded metadata only: never include SDP, candidates, names or account IDs. */
export class RadioDiagnostics {
  private entries: ({ at: string; event: string } & RadioDiagnosticDetails)[] = [];
  private consoleEnabled = false;
  private printed = 0;
  readonly limit = 200;

  constructor() {
    try { this.consoleEnabled = sessionStorage.getItem('perrinn.teamRadio.diagnostics') === '1'; }
    catch { /* Diagnostics must work without browser storage. */ }
  }

  record(event: string, details: RadioDiagnosticDetails = {}) {
    const entry = { at: new Date().toISOString(), event, ...details };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    if (this.consoleEnabled && this.printed < this.limit) {
      console.info('[Team Radio]', entry);
      this.printed++;
    }
  }

  snapshot() { return this.entries.map(entry => ({ ...entry })); }
}
