import { Component } from '@angular/core';

@Component({
  selector: 'prototype-community-dashboard',
  templateUrl: './community-dashboard.component.html',
  styleUrls: ['./community-dashboard.component.css'],
  standalone: false
})
export class CommunityDashboardComponent {
  readonly layouts = [
    { id: 'classic-social-feed', name: 'Classic social feed' },
    { id: 'community-dashboard', name: 'Community dashboard' },
    { id: 'mobile-first-social', name: 'Mobile-first social' }
  ];
  activeNav = 'Overview';
  eventJoined = false;
  readonly navigation = ['Overview', 'Community', 'Messages', 'Events', 'Directory'];
  readonly conversations = [
    { initials: 'MC', name: 'Maya Chen', preview: 'See you at the walk!', time: '10:42' },
    { initials: 'TW', name: 'Theo Williams', preview: 'Lunch sounds great', time: 'Yesterday' }
  ];

  get currentLayoutIndex(): number { return this.layouts.findIndex(layout => layout.id === 'community-dashboard'); }
  get previousLayout() { return this.layouts[(this.currentLayoutIndex + this.layouts.length - 1) % this.layouts.length]; }
  get nextLayout() { return this.layouts[(this.currentLayoutIndex + 1) % this.layouts.length]; }
}
