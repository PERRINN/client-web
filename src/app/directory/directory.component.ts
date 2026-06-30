import { Component, OnInit, OnDestroy } from '@angular/core';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { map, takeUntil, switchMap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { UserInterfaceService } from '../userInterface.service';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth'

@Component({
  selector: 'directory',
  templateUrl: 'directory.component.html'
})

export class DirectoryComponent implements OnInit, OnDestroy {

  messages: Observable<any[]>;
  filteredMessages: Observable<any[]>;
  searchQuery: string = '';
  viewMode: 'cards' | 'table' = 'cards';
  private destroy$ = new Subject<void>();
  private searchQuery$ = new BehaviorSubject<string>('');

  constructor(
    public afAuth: AngularFireAuth,
    public afs: AngularFirestore,
    public router: Router,
    public UI: UserInterfaceService
  ) {}

  ngOnInit() {
    this.refreshMembersList();
    this.initializeFilteredMessages();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeFilteredMessages() {
    this.filteredMessages = this.searchQuery$.pipe(
      switchMap(query =>
        this.messages.pipe(
          map(members =>
            members.filter(member =>
              member.values.name.toLowerCase().includes(query.toLowerCase())
            )
          )
        )
      ),
      takeUntil(this.destroy$)
    );
  }

  onSearchChange() {
    this.searchQuery$.next(this.searchQuery);
  }

  clearSearch() {
    this.searchQuery = '';
    this.searchQuery$.next('');
  }

  refreshMembersList() {
    this.messages = this.afs.collection('PERRINNMessages', ref => ref
      .where('userChain.nextMessage', '==', 'none')
      .where('verified', '==', true)
      .where('wallet.balance', '>', 0)
      .orderBy('wallet.balance', "desc")
      .limit(200))
      .snapshotChanges()
      .pipe(
        map(changes => {
          return changes.map(c => ({
            key: c.payload.doc.id,
            values: c.payload.doc.data(),
          }));
        }),
        takeUntil(this.destroy$)
      );
  }

}
