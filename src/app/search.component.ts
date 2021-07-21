import { Component } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore';
import * as firebase from 'firebase/app';

@Component({
  selector:'search',
  template:`
  <div class="sheet">
  <input id="searchInput" maxlength="500" (keyup)="refreshSearchLists()" [(ngModel)]="searchFilter" placeholder="Search">
  <div class="buttonDiv" *ngIf="searchFilter==''" style="color:white;margin:10px;width:150px;font-size:11px;background-color:midnightblue" (click)="refreshMembersList()">Members list</div>
  <div class="seperator" style="width:100%;margin:0px"></div>
  </div>
  <div class='sheet'>
  <ul class="listLight">
    <li *ngFor="let message of messages | async" style="float:left;padding:5px">
      <div style="float:left;width:250px;height:115px" (click)="router.navigate(['profile',message.values.user])">
        <img [src]="message?.values.imageUrlThumbUser" style="float:left;margin:0 10px 65px 10px;opacity:1;object-fit:cover;height:50px;width:50px;border-radius:50%">
        <span>{{message.values?.name}} {{UI.formatCOINS(message.values?.wallet?.balance||0)}}</span>
        <br>
        <span *ngIf="message.values?.userStatus?.isMember" style="font-size:10px">Member</span>
        <span *ngIf="message.values?.userStatus?.isDeveloper" style="font-size:10px"> Developer ({{message.values?.contract?.position}} Level {{message.values?.contract?.level}})</span>
        <span *ngIf="message.values?.userStatus?.isInvestor" style="font-size:10px"> Investor</span>
      </div>
    </li>
  </ul>
  <div class="seperator" style="width:100%;margin:0px"></div>
  </div>
  `,
})

export class SearchComponent  {

  messages:Observable<any[]>;
  searchFilter:string;

  constructor(
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService
  ) {
    this.searchFilter='';
  }

  ngOnInit() {
    document.getElementById('searchInput').focus();
    this.refreshSearchLists();
  }

  refreshSearchLists() {
    if (this.searchFilter) {
      if (this.searchFilter.length > 1) {
        this.messages = this.afs.collection('PERRINNMessages', ref => ref
        .where('userChain.nextMessage','==','none')
        .where('verified','==',true)
        .where('nameLowerCase','>=',this.searchFilter.toLowerCase())
        .where('nameLowerCase','<=',this.searchFilter.toLowerCase()+'\uf8ff')
        .orderBy('nameLowerCase')
        .limit(10))
        .snapshotChanges().pipe(map(changes => {
          return changes.map(c => ({
            key:c.payload.doc.id,
            values:c.payload.doc.data(),
          }));
        }));
      }
    } else {
      this.messages = null;
    }
  }

  refreshMembersList() {
    this.messages = this.afs.collection('PERRINNMessages', ref => ref
    .where('userChain.nextMessage','==','none')
    .where('verified','==',true)
    .where('wallet.balance','>',0)
    .orderBy('wallet.balance',"desc")
    .limit(50))
    .snapshotChanges().pipe(map(changes => {
      return changes.map(c => ({
        key:c.payload.doc.id,
        values:c.payload.doc.data(),
      }));
    }));
  }

}
