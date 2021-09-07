import { Component } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore';
import * as firebase from 'firebase/app';

@Component({
  selector:'directory',
  template:`
  <div class="sheet">
  <div class="buttonDiv" style="color:white;margin:10px;width:150px;font-size:11px;background-color:midnightblue" (click)="refreshMembersList()">Members list</div>
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
        <span *ngIf="message.values?.userStatus?.isContributor" style="font-size:10px"> Contributor</span>
        <span *ngIf="message.values?.userStatus?.isInvestor" style="font-size:10px"> Investor</span>
        <br>
        <span *ngIf="message.values?.userStatus?.isContributor" style="font-size:10px">{{message.values?.contract?.position}} Level {{message.values?.contract?.level}}</span>
      </div>
    </li>
  </ul>
  <div class="seperator" style="width:100%;margin:0px"></div>
  </div>
  `,
})

export class DirectoryComponent  {

  messages:Observable<any[]>;

  constructor(
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService
  ){

  }

  ngOnInit() {
    this.refreshMembersList();
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
