import { Component } from '@angular/core';
import { AngularFireDatabase, FirebaseObjectObservable, FirebaseListObservable } from 'angularfire2/database';
import { AngularFireAuth } from 'angularfire2/auth';
import { Observable } from 'rxjs/Observable';
import * as firebase from 'firebase/app';
import { Router } from '@angular/router'

@Component({
  selector: 'createTeam',
  template: `
  <div class="sheet">
  <div style="float: left; width: 50%;">
  <input maxlength="25" [(ngModel)]="newTeam" style="text-transform: uppercase;" placeholder="Enter team name *" />
  <input type="file" name="projectImage" id="projectImage" class="inputfile" (change)="onImageChange($event)" accept="image/*">
  <label class="buttonUploadImage" for="projectImage" id="buttonFile" style="padding:15px">
  <img src="./../assets/App icons/camera.png" style="width:25px">
  <span class="tipText">Max 3.0Mb</span>
  </label>
  <button *ngIf="photoURL!=null" (click)="createNewTeam(currentUserID, newTeam)">Create team</button>
  </div>
  <div style="float: right; width: 50%;">
  <img *ngIf="photoURL!=null" [src]="this.photoURL" style="object-fit:contain; height:200px; width:100%" routerLink="/user" routerLinkActive="active">
  </div>
  </div>
  `,
})
export class CreateTeamComponent {
  currentUser: FirebaseObjectObservable<any>;
  currentUserID: string;
  photoURL: string;
  newTeam: string;

  constructor(public afAuth: AngularFireAuth, public db: AngularFireDatabase, public router: Router) {
    this.afAuth.authState.subscribe((auth) => {
      if (auth==null){}
      else {
        this.currentUserID = auth.uid;
      }
    });
  }

  createNewTeam(userID: string, teamName: string) {
    teamName = teamName.toUpperCase();
    var teamID = this.db.list('ids/').push(true).key;
    this.db.object('teamUsers/'+teamID+'/'+userID).update({member: true, leader: true});
    this.db.object('teams/'+teamID).update({name: teamName, photoURL: this.photoURL, organisation: "Family and Friends"});
    this.db.object('userTeams/'+userID+'/'+teamID).update({following: true, lastChatVisitTimestamp: firebase.database.ServerValue.TIMESTAMP});
    this.db.object('userInterface/' + userID).update({currentTeam: teamID});
    this.router.navigate(['teamProfile']);
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
        this.photoURL=task.snapshot.downloadURL;
      }
    );
  }

  errorHandler(event) {
    event.target.src = "https://static1.squarespace.com/static/5391fac1e4b07b6926545c34/t/54b948f4e4b0567044b6c023/1421428991081/";
  }

}
