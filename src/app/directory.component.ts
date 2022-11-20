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
  <div class="buttonDiv" style="color:white;margin:10px;width:150px;font-size:11px;background-color:black" (click)="refreshMembersList()">Members list</div>
  <div class="seperator" style="width:100%;margin:0px"></div>
  </div>
  <div class='sheet'>
  <ul class="listLight">
    <li *ngFor="let message of messages | async">
      <div (click)="router.navigate(['profile',message.values.user])">
        <img [src]="message?.values.imageUrlThumbUser" style="float:left;margin:10px;opacity:1;object-fit:cover;height:50px;width:50px;border-radius:50%">
        <div style="float:left;padding:10px;width:20%">
          <div style="font-weight:bold">{{message.values?.name}}</div>
        </div>
        <div style="float:left;padding:10px;width:45%">
          <span style="font-size:10px"> {{message.values?.userPresentation}}</span>
          <span *ngIf="message.values?.contract?.signed" style="font-size:10px"> {{message.values?.contract?.position}} Level {{message.values?.contract?.levelTimeAdjusted|number:'1.1-1'}}</span>
        </div>
        <div style="float:right;margin:10px;width:50px">{{UI.formatCOINS(message.values?.wallet?.balance||0)}}</div>
      </div>
      <div class="seperator"></div>
    </li>
  </ul>
  <div class="seperator" style="width:100%;margin:0px;cursor:default"></div>
  <ul class="listLight" style="margin:10px">
    <li *ngFor="let message of messages | async" style="float:left;cursor:default">
      <img [src]="message?.values.imageUrlThumbUser" style="float:left;opacity:1;object-fit:cover;height:75px;width:75px">
    </li>
  </ul>
  <div class="seperator" style="width:100%;margin:0px;cursor:default"></div>
  <ul class="listLight" style="margin:10px">
    <li *ngFor="let message of messages | async" style="float:left;cursor:text;user-select:text">
      <span>{{message.values?.name}} </span>
      <span>{{UI.formatCOINS(message.values?.wallet?.balance||0)}}&nbsp;&nbsp;</span>
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
