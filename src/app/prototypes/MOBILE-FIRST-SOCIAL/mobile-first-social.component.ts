import { Component } from '@angular/core';

@Component({
  selector: 'prototype-mobile-first-social',
  templateUrl: './mobile-first-social.component.html',
  styleUrls: ['./mobile-first-social.component.css'],
  standalone: false
})
export class MobileFirstSocialComponent {
  readonly layouts = [
    { id: 'CLASSIC-SOCIAL-FEED', name: 'Classic social feed' },
    { id: 'COMMUNITY-DASHBOARD', name: 'Community dashboard' },
    { id: 'MOBILE-FIRST-SOCIAL', name: 'Mobile-first social' }
  ];
  activeNav = 'Home';
  filter = 'For you';
  readonly navigation = ['Home', 'Discover', 'Messages', 'Profile'];
  readonly stories = [
    { initials: 'MC', name: 'Maya', tone: 'sage' },
    { initials: 'TW', name: 'Theo', tone: 'clay' },
    { initials: 'SK', name: 'Samira', tone: 'blue' },
    { initials: 'JD', name: 'Jordan', tone: 'sand' }
  ];
  posts = [
    { name: 'Samira Khan', initials: 'SK', time: '24 min', category: 'Members', text: 'Small reminder: you don’t have to do it all at once. One good conversation can change the whole week.', likes: 21, liked: false, saved: false },
    { name: 'PERRINN Community', initials: 'P', time: '2 hr', category: 'Events', text: 'This Saturday: our community lunch is back. Bring a dish, bring a friend, or just bring yourself.', likes: 16, liked: true, saved: false },
    { name: 'Jordan Davis', initials: 'JD', time: 'Yesterday', category: 'Members', text: 'New here and already feeling at home. Thanks for making it so easy to join in.', likes: 9, liked: false, saved: true }
  ];

  get currentLayoutIndex(): number { return this.layouts.findIndex(layout => layout.id === 'MOBILE-FIRST-SOCIAL'); }
  get previousLayout() { return this.layouts[(this.currentLayoutIndex + this.layouts.length - 1) % this.layouts.length]; }
  get nextLayout() { return this.layouts[(this.currentLayoutIndex + 1) % this.layouts.length]; }

  toggleLike(post: typeof this.posts[number]): void {
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
  }
}
