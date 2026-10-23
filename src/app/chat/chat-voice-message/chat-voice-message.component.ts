import { ChangeDetectorRef, Component, Input, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChatMessage } from '../chatData';
import { ChatVoiceService } from '../chatVoice.service';

@Component({ selector: 'app-chat-voice-message', standalone: false,
  templateUrl: './chat-voice-message.component.html', styleUrls: ['./chat-voice-message.component.css'] })
export class ChatVoiceMessageComponent implements OnDestroy {
  @Input() message!: ChatMessage;
  private changes: Subscription;
  constructor(public voice: ChatVoiceService, detector: ChangeDetectorRef) {
    this.changes = voice.changed.subscribe(() => detector.markForCheck());
  }
  ngOnDestroy(): void { this.changes.unsubscribe(); }
}
