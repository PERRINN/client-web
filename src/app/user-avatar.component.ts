import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { avatarInitials, userPhotoSources } from './userAvatar';

/** Pure presentation: callers supply the name/photos and retain layout and actions. */
@Component({
  selector: 'app-user-avatar',
  templateUrl: './user-avatar.component.html',
  styleUrls: ['./user-avatar.component.css'],
  host: { role: 'img', '[attr.aria-label]': "name || 'Contributor'" },
  standalone: false
})
export class UserAvatarComponent implements OnChanges {
  @Input() name: string | null | undefined;
  @Input() sources: string | readonly (string | null | undefined)[] | null | undefined;
  initials = '?';
  src: string | null = null;
  private photos: string[] = [];
  private failed = new Set<string>();
  private index = 0;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['name']) this.initials = avatarInitials(this.name);
    if (changes['sources']) {
      this.photos = userPhotoSources(this.sources);
      this.failed.clear();
      this.index = 0;
      this.src = this.photos[0] || null;
    }
  }

  onPhotoError() {
    if (!this.src) return;
    this.failed.add(this.src);
    this.src = this.photos[++this.index] || null;
  }

  previewSource(original?: string | null) {
    const photo = userPhotoSources(original)[0];
    return this.src ? (photo && !this.failed.has(photo) ? photo : this.src) : null;
  }
}
