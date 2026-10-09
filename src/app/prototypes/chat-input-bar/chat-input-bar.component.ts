import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';

@Component({
  selector: 'prototype-chat-input-bar',
  templateUrl: './chat-input-bar.component.html',
  styleUrls: ['./chat-input-bar.component.css'],
  standalone: false
})
export class ChatInputBarComponent implements OnDestroy {
  @ViewChild('messageInput') messageInput?: ElementRef<HTMLTextAreaElement>;
  draft = '';
  imageUrl = '';
  imageName = '';
  readonly messages = [
    { author: 'Maya', text: 'The latest bodywork photos are ready to share.', image: '' },
    { author: 'You', text: 'Great, I’ll take a look after the design review.', image: '' }
  ];

  resizeInput(input: HTMLTextAreaElement): void {
    input.style.height = '36px';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    input.style.overflowY = input.scrollHeight > 160 ? 'auto' : 'hidden';
  }

  onInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  onPaste(event: ClipboardEvent): void {
    const image = Array.from(event.clipboardData?.items || [])
      .find(item => item.type.startsWith('image/'))?.getAsFile();
    if (image) {
      event.preventDefault();
      this.setImage(image);
    }
  }

  onFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file?.type.startsWith('image/')) this.setImage(file);
    (event.target as HTMLInputElement).value = '';
  }

  send(): void {
    const text = this.draft.trim();
    if (!text && !this.imageUrl) return;
    this.messages.push({ author: 'You', text, image: this.imageUrl });
    this.draft = '';
    this.imageUrl = '';
    this.imageName = '';
    const input = this.messageInput?.nativeElement;
    if (input) {
      input.style.height = '36px';
      input.style.overflowY = 'hidden';
    }
  }

  clearImage(): void {
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = '';
    this.imageName = '';
  }

  ngOnDestroy(): void {
    this.clearImage();
    this.messages.forEach(message => {
      if (message.image.startsWith('blob:')) URL.revokeObjectURL(message.image);
    });
  }

  private setImage(file: File): void {
    this.clearImage();
    this.imageUrl = URL.createObjectURL(file);
    this.imageName = file.name || 'Pasted image';
  }
}
