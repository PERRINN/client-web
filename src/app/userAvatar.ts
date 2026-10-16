/** Legacy shared silhouettes are placeholders, not personal photos. */
export function userPhotoSources(sources: string | readonly (string | null | undefined)[] | null | undefined): string[] {
  const values = Array.isArray(sources) ? sources : [sources];
  return [...new Set(values.filter((url): url is string => typeof url === 'string')
    .map(url => url.trim()).filter(url => url && !['null', 'undefined'].includes(url)
      && !/1709995468152|1585144867972/.test(url) && !/^(javascript|vbscript):/i.test(url)))];
}

export function avatarInitials(name?: string | null): string {
  const words = (name || '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
  return Array.from(initials).slice(0, 2).join('') || '?';
}
