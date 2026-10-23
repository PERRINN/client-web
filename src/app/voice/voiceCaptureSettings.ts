interface VoiceBrowser {
  userAgent?: string;
  userAgentData?: { platform?: string };
}

export function defaultVoiceEchoCancellation(browser: VoiceBrowser = typeof navigator === 'undefined' ? {} : navigator): boolean {
  // Android startup feedback can be suppressed by its echo-cancelled capture
  // preset. Preserve voice processing elsewhere, including iPhone input gain.
  const platform = browser.userAgentData?.platform;
  return platform ? platform.toLowerCase() !== 'android' : !/\bAndroid\b/i.test(browser.userAgent || '');
}
