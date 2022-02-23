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
      <div style="float:left;width:250px;height:175px" (click)="router.navigate(['profile',message.values.user])">
        <img [src]="message?.values.imageUrlThumbUser" style="float:left;margin:0 10px 125px 10px;opacity:1;object-fit:cover;height:50px;width:50px;border-radius:50%">
        <span>{{message.values?.name}} </span>
        <span style="font-size:8px;font-style:italic">424 </span>
        <span>{{UI.formatCOINS(message.values?.wallet?.balance||0)}}</span>
        <br *ngIf="message.values?.isUserAnOrganisation">
        <span *ngIf="message.values?.isUserAnOrganisation" style="font-size:10px;font-weight:bold">Organisation</span>
        <br>
        <span *ngIf="message.values?.contract?.signed" style="font-size:10px;padding:3px;color:white;background-color:midnightblue">Contributor</span>
        <br>
        <span style="font-size:10px">{{message.values?.userPresentation}} {{message.values?.contract?.position}} Level {{message.values?.contract?.levelTimeAdjusted|number:'1.1-1'}}</span>
      </div>
    </li>
  </ul>
  <div class="seperator" style="width:100%;margin:0px;cursor:default"></div>
  <ul class="listLight" style="margin:10px">
    <li *ngFor="let message of messages | async" style="float:left;cursor:default">
      <img [src]="message?.values.imageUrlThumbUser" style="float:left;opacity:1;object-fit:cover;height:75px;width:75px">
    </li>
  </ul>
  <div class="seperator" style="width:100%;margin:0px;cursor:default"></div>
  <div style="font-size:14px;margin:20px;color:#444">Contributors only</div>
  <ul class="listLight" style="margin:10px;max-width:500px">
    <li *ngFor="let message of messages | async" style="float:left;cursor:default">
      <img *ngIf="message?.values?.contract?.signed" [src]="message?.values.imageUrlThumbUser" style="float:left;opacity:1;object-fit:cover;height:75px;width:75px">
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
