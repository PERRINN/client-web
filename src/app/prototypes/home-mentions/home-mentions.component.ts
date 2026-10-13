import { Component, ElementRef, ViewChild } from '@angular/core';

interface MentionPreview {
  id: string;
  title: string;
  preview: string;
  time: string;
}

@Component({
  selector: 'app-home-mentions',
  templateUrl: './home-mentions.component.html',
  styleUrls: ['../../home.component.css', './home-mentions.component.css'],
  standalone: false
})
export class HomeMentionsComponent {
  @ViewChild('chatTitle') chatTitle?: ElementRef<HTMLElement>;
  state = 'mentions';
  previewWidth = 1080;
  selectedChat: MentionPreview | null = null;
  private resizeStart: { x: number; width: number } | null = null;
  readonly mentions: MentionPreview[] = [
    { id: 'design-review', title: '424 design review', preview: 'Nicolas, can you review the updated rear wing before our next session?', time: '12m ago' },
    { id: 'test-planning', title: 'Track test planning', preview: 'Nicolas, which test window works best for the team?', time: '1h ago' },
    { id: 'team-updates', title: 'Team updates', preview: 'Thanks Nicolas — the latest build photos are ready to share.', time: '3h ago' }
  ];

  openChat(chat: MentionPreview): void {
    this.selectedChat = chat;
    requestAnimationFrame(() => this.chatTitle?.nativeElement.focus());
  }

  closeChat(): void {
    const id = this.selectedChat?.id;
    this.selectedChat = null;
    requestAnimationFrame(() => document.getElementById(`mention-${id}`)?.focus());
  }

  setState(event: Event): void {
    this.state = (event.target as HTMLSelectElement).value;
    this.selectedChat = null;
  }

  startResize(event: PointerEvent, frame: HTMLElement): void {
    event.preventDefault();
    this.resizeStart = { x: event.clientX, width: frame.getBoundingClientRect().width };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  resize(event: PointerEvent): void {
    if (this.resizeStart) this.setWidth(this.resizeStart.width + event.clientX - this.resizeStart.x);
  }

  endResize(): void { this.resizeStart = null; }
  setWidth(width: number): void { this.previewWidth = Math.round(Math.max(320, Math.min(1440, width))); }
}
