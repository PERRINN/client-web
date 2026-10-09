import { Component } from '@angular/core';

@Component({
  selector: 'prototype-classic-social-feed',
  templateUrl: './classic-social-feed.component.html',
  styleUrls: ['./classic-social-feed.component.css'],
  standalone: false
})
export class ClassicSocialFeedComponent {
  readonly layouts = [
    { id: 'classic-social-feed', name: 'Classic social feed' },
    { id: 'community-dashboard', name: 'Community dashboard' },
    { id: 'mobile-first-social', name: 'Mobile-first social' }
  ];
  activeNav = 'Home';
  draft = '';
  showComposer = false;
  readonly navigation = ['Home', 'Members', 'Messages', 'Events'];
  posts = [
    { name: 'Maya Chen', initials: 'MC', time: '12 min ago', text: 'A lovely morning at the riverside walk. Thanks to everyone who joined us.', likes: 8, liked: false },
    { name: 'Theo Williams', initials: 'TW', time: '1 hour ago', text: 'I have two spare places for Saturday’s community lunch. Who’s in?', likes: 14, liked: true }
  ];

  get currentLayoutIndex(): number { return this.layouts.findIndex(layout => layout.id === 'classic-social-feed'); }
  get previousLayout() { return this.layouts[(this.currentLayoutIndex + this.layouts.length - 1) % this.layouts.length]; }
  get nextLayout() { return this.layouts[(this.currentLayoutIndex + 1) % this.layouts.length]; }

  toggleLike(post: typeof this.posts[number]): void {
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
  }

  publish(): void {
    if (!this.draft.trim()) return;
    this.posts.unshift({ name: 'You', initials: 'YO', time: 'Just now', text: this.draft.trim(), likes: 0, liked: false });
    this.draft = '';
    this.showComposer = false;
  }
}
