import { Directive, HostListener, EventEmitter, Output, ElementRef, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { auditTime } from 'rxjs/operators';

@Directive({
  selector: '[scrollable]'
})
export class ScrollableDirective implements OnDestroy {

  @Output() scrollPosition = new EventEmitter();
  private scrollSubject = new Subject<any>();
  private subscription = this.scrollSubject.pipe(auditTime(50)).subscribe(event => {
    this.processScroll(event);
  });

  constructor(public el: ElementRef) { }

  @HostListener('scroll', ['$event'])
  onScroll(event) {
    this.scrollSubject.next(event);
  }

  private processScroll(event) {
    try {
      const top = event.target.scrollTop;
      const height = this.el.nativeElement.scrollHeight;
      const offset = this.el.nativeElement.offsetHeight;

      // emit bottom event
      if (top > height - offset - 1) {
        this.scrollPosition.emit('bottom');
      }

      // emit top event
      if (top === 0) {
        this.scrollPosition.emit('top');
      }
    } catch (err) {}
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

}
