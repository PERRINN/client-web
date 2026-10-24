export interface SettingsProfile {
  user?: string;
  name?: string;
  userPresentation?: string;
  publicLink?: string;
  userCurrency?: string;
  userImageTimestamp?: string;
  imageUrlThumbUser?: string;
  imageUrlMedium?: string;
  imageUrlOriginal?: string;
  wallet?: { balance?: number };
  contract?: { level?: number; levelTimeAdjusted?: number; signed?: boolean; createdTimestamp?: number };
}
export interface ProfileDraft { name: string; userPresentation: string; publicLink: string; }
export type ProfileField = keyof ProfileDraft;
export const profileFields: ProfileField[] = ['name', 'userPresentation', 'publicLink'];
export function profileDraft(profile: SettingsProfile): ProfileDraft {
  return { name: profile.name || '', userPresentation: profile.userPresentation || '', publicLink: profile.publicLink || '' };
}
export function profileChanges(draft: ProfileDraft, baseline: ProfileDraft): Partial<ProfileDraft> {
  return Object.fromEntries(profileFields.filter(key => draft[key].trim() !== baseline[key]).map(key => [key, draft[key].trim()]));
}
export function profileErrors(draft: ProfileDraft, baseline: ProfileDraft): Partial<Record<ProfileField, string>> {
  const errors: Partial<Record<ProfileField, string>> = {};
  if (!draft.name.trim()) errors.name = 'Enter your first name.';
  if (draft.userPresentation.trim().length > 150) errors.userPresentation = 'Use 150 characters or fewer.';
  if (baseline.userPresentation && !draft.userPresentation.trim()) errors.userPresentation = 'Presentation cannot be empty.';
  if (baseline.publicLink && !draft.publicLink.trim()) errors.publicLink = 'Public link cannot be empty.';
  if (draft.publicLink.trim() && draft.publicLink.trim() !== baseline.publicLink) {
    try {
      const url = new URL(draft.publicLink.trim());
      if (!['https:', 'http:'].includes(url.protocol)) errors.publicLink = 'Enter a valid website address.';
    } catch { errors.publicLink = 'Enter a valid website address.'; }
  }
  return errors;
}
