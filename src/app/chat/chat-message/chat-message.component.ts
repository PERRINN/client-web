import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { ChatMessage } from '../chatData';
import { containsMention } from '../chatMention';
import { creditDuration } from '../chatTimeCredits';

@Component({ selector: 'app-chat-message', templateUrl: './chat-message.component.html', styleUrls: ['./chat-message.component.css'], standalone: false,
  host: { '[class.group-end]': 'groupEnd' } })
export class ChatMessageComponent implements OnChanges {
  readonly creditDuration = creditDuration;
  @Input() message!: ChatMessage;
  @Input() continued = false;
  @Input() groupEnd = true;
  @Input() signedIn = false;
  @Input() viewerName = '';
  @Input() timeCreditAmount = '';
  @Output() imageOpened = new EventEmitter<ChatMessage>();
  @Output() imageLoaded = new EventEmitter<void>();
  mentioned = false;
  ngOnChanges(): void {
    this.mentioned = this.signedIn && !this.message.own && !this.message.transfers?.length && containsMention(this.message.text, this.viewerName);
  }
}
