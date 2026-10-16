// Match full names without treating punctuation in a name as a regular expression.
export function containsMention(text: string, name: string): boolean {
  const words = name.trim().normalize('NFC').split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const pattern = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${pattern}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text.normalize('NFC'));
}
