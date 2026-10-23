export interface VoiceDiagnosticRow { label: string; value: string; ok: boolean }

// Keep only machine codes, never exception messages that could contain data.
export function voiceDiagnosticCode(error: unknown): string {
  const code = (error as { code?: unknown; name?: string })?.code;
  if (typeof code === 'number' && Number.isInteger(code) && code < 0) return 'NG' + Math.abs(code).toString().padStart(4, '0');
  if (typeof code === 'string' && /^[a-zA-Z0-9/-]{1,64}$/.test(code)) return code.replace('functions/', '');
  const name = (error as { name?: string })?.name;
  return name && /^[a-zA-Z]{1,40}$/.test(name) ? name : 'Unknown error';
}
