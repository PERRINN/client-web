import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';

export interface ChatDraft { text: string; image: File | null; }

// Emits a draft without clearing it. The consumer clears only after a successful send.
@Component({
  selector: 'app-chat-composer',
  templateUrl: './chat-composer.component.html',
  styleUrls: ['./chat-composer.component.css'],
  standalone: false
})
export class ChatComposerComponent implements OnDestroy {
  @Input() disabled = false;
  @Input() sending = false;
  uploadProgress: number | null = null;
  @Output() messageSent = new EventEmitter<ChatDraft>();
  @ViewChild('messageInput') messageInput?: ElementRef<HTMLTextAreaElement>;
  draft = '';
  imageUrl = '';
  imageName = '';
  error = '';
  private image: File | null = null;

  resizeInput(input: HTMLTextAreaElement): void {
    input.style.height = '42px';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    input.style.overflowY = input.scrollHeight > 160 ? 'auto' : 'hidden';
  }

  onInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); this.send();
    }
  }

  onPaste(event: ClipboardEvent): void {
    const image = Array.from(event.clipboardData?.items || [])
      .find(item => item.type.startsWith('image/'))?.getAsFile();
    if (image && !this.disabled) { event.preventDefault(); this.setImage(image); }
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0] && !this.disabled) this.setImage(input.files[0]);
    input.value = '';
  }

  send(): void {
    const text = this.draft.trim();
    if (this.disabled || (!text && !this.image)) return;
    if (text.length > 500) { this.error = 'Messages can contain up to 500 characters.'; return; }
    this.messageSent.emit({ text, image: this.image });
  }

  setUploadProgress(percent: number | null): void { this.uploadProgress = percent; }

  clearDraft(): void {
    this.draft = ''; this.clearImage(); this.uploadProgress = null;
    const input = this.messageInput?.nativeElement;
    if (input) { input.style.height = '42px'; input.style.overflowY = 'hidden'; requestAnimationFrame(() => input.focus()); }
  }

  clearImage(): void {
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = ''; this.imageName = ''; this.image = null; this.error = '';
  }

  ngOnDestroy(): void { this.clearImage(); }

  private setImage(file: File): void {
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      this.error = 'Choose a PNG, JPEG, GIF or WebP image.'; return;
    }
    if (file.size > 15 * 1024 * 1024) { this.error = 'Choose an image smaller than 15 MB.'; return; }
    this.clearImage(); this.image = file;
    this.imageUrl = URL.createObjectURL(file);
    this.imageName = file.name || 'Pasted image';
  }
}
