import { Component } from '@angular/core';
import { AngularFireDatabase, FirebaseListObservable, FirebaseObjectObservable } from 'angularfire2/database';
import * as firebase from 'firebase/app';
import 'firebase/storage';
import { AngularFireAuth } from 'angularfire2/auth';
import { DomSanitizer } from '@angular/platform-browser';
import { Router, NavigationEnd } from '@angular/router'

@Component({
  selector: 'chat',
  template: `
  <div class="sheet">
  <div class="chat" id="chat-scroll">
  <div>
  <div style="color:blue; padding:10px 0 10px 0; cursor:pointer; text-align:center" (click)="messageNumberDisplay=messageNumberDisplay+15;this.teamMessages = this.db.list('teamMessages/' + this.currentTeamID, {query: {limitToLast: messageNumberDisplay}});">More messages</div>
  <ul style="list-style: none;">
    <li *ngFor="let message of teamMessages | async ; let last = last ; let i = index">
    <div class="newDay" *ngIf="isMessageNewGroup(message.timestamp)">{{message.timestamp|date:'yMMMMEEEEd'}}</div>
    <div style="display: inline; float: left; height:35px; width:5px"></div>
    <div style="display: inline; float: left; height:35px; width:2px">
    <div [hidden]="lastChatVisitTimestamp>message.timestamp" style="height:35px;width:2px;background-color:red;"></div>
    </div>
    <img (error)="errorHandler($event)" [src]="getPhotoURL(message.author)" style="cursor:pointer;display: inline; float: left; margin: 0 10px 10px 10px; border-radius:3px; object-fit: cover; height:35px; width:35px" (click)="db.object('userInterface/'+currentUserID).update({focusUser: message.author});router.navigate(['userProfile'])">
    <div style="font-weight: bold; display: inline; float: left; margin-right: 10px">{{getFirstName(message.author)}}</div>
    <div style="color: #AAA;">{{message.timestamp | date:'jm'}}</div>
    <div style="color: #404040;padding: 0 50px 10px 0;" [innerHTML]="message.text | linky"></div>
    <img *ngIf="message.image" [src]="message.image" style="clear:left;width:100%;max-height:350px;object-fit:contain;padding: 0 0 10px 0;">
    {{last?scrollToBottom(message.timestamp):''}}
    </li>
  </ul>
  <div style="height:125px;width:100%"></div>
  </div>
  </div>
  <div class="sheet" style="position: fixed;bottom: 0;width:100%;box-shadow:none">
  <div style="color:blue; padding:5px 0 5px 15px; cursor:pointer;float:left" (click)="timestampChatVisit()">Mark all read</div>
  <ul style="list-style:none;float:left;">
    <li *ngFor="let author of draftMessageAuthors | async">
    <div [hidden]="!author.draftMessage||author.$key==currentUserID" *ngIf="isDraftMessageRecent(author.draftMessageTimestamp)" style="padding:5px 0 5px 15px;float:left;font-weight:bold">{{getFirstName(author.$key)}}...</div>
    </li>
  </ul>
  <input type="file" name="chatImage" id="chatImage" class="inputfile" (change)="onImageChange($event)" accept="image/*">
  <label class="buttonUploadImage" [hidden]='!currentUserIsMember' for="chatImage" id="buttonFile" style="float:right;padding:5px 35px 5px 0px;">
  <img src="./../assets/App icons/camera.png" style="width:25px">
  <span class="tipText">Max 3.0Mb</span>
  </label>
  <textarea [hidden]='!currentUserIsMember' class="textAreaChat" maxlength="500" (keyup.enter)="addMessage()" (keyup)="updateDraftMessageDB()" [(ngModel)]="draftMessage" placeholder="Message team"></textarea>
  </div>
  </div>
    `,
})
export class ChatComponent {
  draftMessage: string;
  draftImage: string;
  draftMessageDB: boolean;
  draftMessageAuthors: FirebaseListObservable<any>;
  teamMessages: FirebaseListObservable<any>;
  currentUserID: string;
  currentTeamID: string;
  messageNumberDisplay: number;
  lastChatVisitTimestamp: number;
  scrollMessageTimestamp: number;
  previousMessageTimestamp: number;
  currentUserIsMember: boolean;

  constructor(public sanitizer: DomSanitizer, public afAuth: AngularFireAuth, public db: AngularFireDatabase, public router: Router) {
    this.previousMessageTimestamp=0;
    this.draftMessageDB=false;
    this.draftImage="";
    this.draftMessage="";
    this.currentUserIsMember=false;
    this.afAuth.authState.subscribe((auth) => {
      if (auth==null){}
      else {
        this.currentUserID = auth.uid;
        db.object('userInterface/'+auth.uid).subscribe(userInterface => {
          this.messageNumberDisplay = 15;
          this.currentTeamID = userInterface.currentTeam;
          this.teamMessages = this.db.list('teamMessages/' + this.currentTeamID, {query: {limitToLast: this.messageNumberDisplay}});
          this.draftMessageAuthors = this.db.list('teamActivities/'+this.currentTeamID+'/draftMessages/');
          this.db.object('teamUsers/'+this.currentTeamID+'/'+auth.uid).subscribe(teamUser=>{
            if (teamUser!=null && teamUser.member) {this.currentUserIsMember=true}
          });
          this.db.object('userTeams/'+this.currentUserID+'/'+this.currentTeamID).subscribe(userTeam=>{
            this.lastChatVisitTimestamp = Number(userTeam.lastChatVisitTimestamp);
          });
        });
      }
    });
  }

  isMessageNewGroup (messageTimestamp) {
    var isMessageNewGroup: boolean;
    isMessageNewGroup= Math.abs(messageTimestamp-this.previousMessageTimestamp)>1000*60*60*4;
    this.previousMessageTimestamp=messageTimestamp;
    return isMessageNewGroup;
  }

  isDraftMessageRecent (draftMessageTimestamp) {
    return (Date.now()-draftMessageTimestamp)<1000*60;
  }

  scrollToBottom(scrollMessageTimestamp: number) {
    if (scrollMessageTimestamp!=this.scrollMessageTimestamp) {
      var element = document.getElementById("main_container");
      element.scrollTop = element.scrollHeight;
      this.scrollMessageTimestamp=scrollMessageTimestamp;
    }
  }

  timestampChatVisit(){
    this.db.object('userTeams/'+this.currentUserID+'/'+this.currentTeamID).update({lastChatVisitTimestamp: firebase.database.ServerValue.TIMESTAMP});
  }

  addMessage() {
    this.draftMessage = this.draftMessage.replace(/(\r\n|\n|\r)/gm,"");
    if (this.draftMessage!=""||this.draftImage!="") {
      this.db.object('teamActivities/'+this.currentTeamID).update({lastMessageTimestamp: firebase.database.ServerValue.TIMESTAMP});
      var messageKey = this.db.list('teamMessages/' + this.currentTeamID).push({ timestamp: firebase.database.ServerValue.TIMESTAMP, text: this.draftMessage, image:this.draftImage, author: this.currentUserID}).key;
      this.addMessageTimestampNegative (this.currentTeamID, messageKey);
      this.draftMessage = "";
      this.draftImage = "";
    }
  }

  addMessageTimestampNegative(teamID: string, messageID: string) {
    var timestamp: number;
    var timestampNegative: number;
    this.db.object('teamMessages/'+teamID+'/'+messageID).subscribe(message=>{
      timestamp = message.timestamp;
      timestampNegative = -1 * timestamp;
      this.db.object('teamMessages/'+teamID+'/'+messageID).update({timestampNegative: timestampNegative});
    });
  }

  updateDraftMessageDB () {
    if ((this.draftMessage!="")!=this.draftMessageDB) {
      this.db.object('teamActivities/'+this.currentTeamID+'/draftMessages/'+this.currentUserID).update({draftMessage:this.draftMessage!="",draftMessageTimestamp:firebase.database.ServerValue.TIMESTAMP});
    }
    this.draftMessageDB=(this.draftMessage!="");
  }

  getFirstName (ID: string) :string {
    var output;
    this.db.object('users/' + ID).subscribe(snapshot => {
      output = snapshot.firstName;
    });
    return output;
  }

  getPhotoURL (ID: string) :string {
    var output;
    this.db.object('users/' + ID).subscribe(snapshot => {
      output = snapshot.photoURL;
    });
    return output;
  }

  errorHandler(event) {
    event.target.src = "https://static1.squarespace.com/static/5391fac1e4b07b6926545c34/t/54b948f4e4b0567044b6c023/1421428991081/";
  }

  onImageChange(event) {
    let image = event.target.files[0];
    var uploader = <HTMLInputElement>document.getElementById('uploader');
    var storageRef = firebase.storage().ref('images/'+Date.now()+image.name);
    var task = storageRef.put(image);
    task.on('state_changed',
      function progress(snapshot){
        document.getElementById('buttonFile').style.visibility = "hidden";
        document.getElementById('uploader').style.visibility = "visible";
        var percentage=(snapshot.bytesTransferred/snapshot.totalBytes)*100;
        uploader.value=percentage.toString();
      },
      function error(){
        document.getElementById('buttonFile').style.visibility = "visible";
        document.getElementById('uploader').style.visibility = "hidden";
        uploader.value='0';
      },
      ()=>{
        uploader.value='0';
        document.getElementById('buttonFile').style.visibility = "visible";
        document.getElementById('uploader').style.visibility = "hidden";
        this.draftImage=task.snapshot.downloadURL;
        this.addMessage();
      }
    );
  }

}
