import { Component, OnInit, OnDestroy } from '@angular/core';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { map, takeUntil, switchMap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth'

@Component({
  selector:'directory',
  template:`
  <div class="directoryPage">
    <div class="directoryContainer">
      <div class="island" style="margin-bottom: 20px; line-height: 0;">
        <img [src]="UI.PERRINNProfileLastMessageObj?.imageUrlOriginal" style="width:100%;display:block">
      </div>
      
      <div style="background: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid rgba(5, 150, 105, 0.1); margin-bottom: 32px;">
        <div style="text-align: center;">
          <div style="font-size: 14px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">
            Community Overview
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div style="background: linear-gradient(135deg, rgba(5, 150, 105, 0.1) 0%, rgba(4, 120, 87, 0.05) 100%); padding: 16px; border-radius: 10px; border: 1px solid rgba(5, 150, 105, 0.2);">
              <div style="font-size: 12px; color: #94a3b8; margin-bottom: 8px; font-weight: 500;">Total Members</div>
              <div style="font-size: 24px; font-weight: 700; color: #10b981;">{{UI.PERRINNAdminLastMessageObj?.statistics?.membersCount}}</div>
            </div>
            <div style="background: linear-gradient(135deg, rgba(5, 150, 105, 0.1) 0%, rgba(4, 120, 87, 0.05) 100%); padding: 16px; border-radius: 10px; border: 1px solid rgba(5, 150, 105, 0.2);">
              <div style="font-size: 12px; color: #94a3b8; margin-bottom: 8px; font-weight: 500;">Total Supply</div>
              <div style="font-size: 20px; font-weight: 700; color: #10b981;">{{UI.convertAndFormatPRNToPRNCurrency(null,UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance)}}</div>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-bottom: 24px;">
        <div style="background: #1e293b; padding: 16px; border-radius: 10px; border: 1px solid rgba(5, 150, 105, 0.1);">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span class="material-icons-outlined" style="font-size: 20px; color: #94a3b8; flex-shrink: 0;">search</span>
            <input [(ngModel)]="searchQuery" 
              type="text" 
              placeholder="Search members by name..." 
              style="flex: 1; background: transparent; border: none; color: #f1f5f9; font-size: 14px; outline: none; font-family: inherit;"
              (ngModelChange)="onSearchChange()">
            <button *ngIf="searchQuery" (click)="clearSearch()" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 4px; display: flex; align-items: center;">
              <span class="material-icons-outlined" style="font-size: 18px;">close</span>
            </button>
          </div>
        </div>
      </div>

      <div style="margin-bottom: 32px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div style="font-size: 14px; color: #94a3b8;">
            {{(filteredMessages | async)?.length || 0}} member<span *ngIf="(filteredMessages | async)?.length !== 1">s</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="viewToggleBtn" (click)="viewMode = 'cards'" [style.background-color]="viewMode === 'cards' ? '#10b981' : '#2a3f47'" [style.color]="viewMode === 'cards' ? '#ffffff' : '#94a3b8'" style="padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(5, 150, 105, 0.2); font-weight: 600; font-size: 12px; cursor: pointer; transition: all 0.3s ease;">
              <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">view_comfy</span>
              Cards
            </button>
            <button class="viewToggleBtn" (click)="viewMode = 'table'" [style.background-color]="viewMode === 'table' ? '#10b981' : '#2a3f47'" [style.color]="viewMode === 'table' ? '#ffffff' : '#94a3b8'" style="padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(5, 150, 105, 0.2); font-weight: 600; font-size: 12px; cursor: pointer; transition: all 0.3s ease;">
              <span class="material-icons-outlined" style="font-size: 16px; vertical-align: middle;">format_list_bulleted</span>
              List
            </button>
          </div>
        </div>

        <div *ngIf="viewMode === 'cards'">
          <ul style="list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">
          <li *ngFor="let message of filteredMessages | async" style="cursor: pointer;" (click)="router.navigate(['profile',message.values.user])">
            <div style="background: #1e293b; border: 1px solid rgba(5, 150, 105, 0.1); border-radius: 12px; overflow: hidden; transition: all 0.3s ease; display: flex; flex-direction: column; height: 280px;">
              <img [src]="message?.values.imageUrlThumbUser" (error)="UI.handleUserImageError($event, message?.values)" style="object-fit: contain; height: 112px; width: 100%; display: block; background: rgba(5, 150, 105, 0.03); flex-shrink: 0;">
              <div style="padding: 11px; display: flex; flex-direction: column; flex: 1; overflow: hidden;">
                <div style="font-size: 12px; font-weight: 700; color: #f1f5f9; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px;">{{message.values?.name}}</div>
                <div style="font-size: 11px; color: #cbd5e1; line-height: 1.5; margin-bottom: 8px; min-height: 18px; flex-grow: 1; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-overflow: ellipsis;">
                  <span *ngIf="message.values?.userPresentation">{{message.values?.userPresentation}}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px solid rgba(5, 150, 105, 0.1); margin-top: auto;">
                  <div style="font-size: 10px; color: #94a3b8;">Balance</div>
                  <div style="font-size: 12px; font-weight: 700; color: #10b981;">{{UI.convertAndFormatPRNToPRNCurrency(null,message.values?.wallet?.balance||0)}}</div>
                </div>
                <div *ngIf="((message.values?.wallet?.balance||0)/(UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance))>0.001" style="font-size: 9px; color: #059669; font-weight: 600; margin-top: 6px;">
                  {{((message.values?.wallet?.balance||0)/(UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance))|percent:'1.1-1'}} of supply
                </div>
                <div *ngIf="message.values?.contract?.signed" style="font-size: 9px; color: #94a3b8; margin-top: 6px;">
                  Level {{message.values?.contract?.levelTimeAdjusted|number:'1.1-1'}}
                </div>
                <div *ngIf="message.values?.publicLink" style="font-size: 9px; color: #10b981; margin-top: 6px; display: flex; align-items: center;">
                  <span class="material-icons-outlined" style="font-size: 12px; margin-right: 3px;">link</span>
                  Public Profile
                </div>
              </div>
            </div>
          </li>
        </ul>
        </div>

        <div *ngIf="viewMode === 'table'" style="background: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid rgba(5, 150, 105, 0.1); overflow: visible;">
          <div style="overflow-x: auto; overflow-y: visible;">
            <table style="width: 100%; border-collapse: collapse; table-layout: auto;">
              <thead>
                <tr style="border-bottom: 2px solid rgba(5, 150, 105, 0.2); min-height: 48px; overflow: visible;">
                  <th style="text-align: left; padding: 12px 14px; color: #94a3b8; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; line-height: 1.5; vertical-align: middle;">Name</th>
                  <th style="text-align: right; padding: 12px 14px; color: #94a3b8; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; line-height: 1.5; vertical-align: middle;">Balance</th>
                  <th style="text-align: right; padding: 12px 14px; color: #94a3b8; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; line-height: 1.5; vertical-align: middle;">Share</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let message of filteredMessages | async; let i = index" [style.background]="i % 2 === 0 ? 'transparent' : 'rgba(5, 150, 105, 0.03)'" style="border-bottom: 1px solid rgba(5, 150, 105, 0.05); transition: background 0.2s; cursor: pointer;" (click)="router.navigate(['profile',message.values.user])">
                  <td style="padding: 12px; color: #f1f5f9; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;">{{message.values?.name}}</td>
                  <td style="padding: 12px; text-align: right; color: #10b981; font-weight: 700;">{{UI.convertAndFormatPRNToPRNCurrency(null,message.values?.wallet?.balance||0)}}</td>
                  <td style="padding: 12px; text-align: right; color: #059669; font-weight: 600;">{{((message.values?.wallet?.balance||0)/(UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance))|percent:'1.1-1'}}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
  `
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
