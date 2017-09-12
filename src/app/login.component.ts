import { Component } from '@angular/core';
import { Router } from '@angular/router'
import * as firebase from 'firebase/app';
import { AngularFireAuth } from 'angularfire2/auth';
import { AngularFireDatabase, FirebaseObjectObservable, FirebaseListObservable } from 'angularfire2/database';




@Component({
  selector: 'login',
  template: `
  <div id="login">
    <div class="module form-module">
      <div class="form">
        <form>
          <img (error)="errorHandler($event)" src="./../assets/App icons/PERRINN logo.png" style="width:100%; padding-bottom:10px">
          <div [hidden]="loggedIn">
          <div style="text-align:right; font-size:10px; cursor:pointer; color:blue; padding:10px;" (click)="newUser=!newUser">{{newUser?"Already have an account?":"Need a new account?"}}</div>
          <input maxlength="500" [(ngModel)]="email" name="email" type="text" placeholder="Email *"/>
          <input maxlength="500" [(ngModel)]="password" name="password" type="password" placeholder="Password *"/>
          <button [hidden]="newUser" type="button" (click)="login(email,password)">Login {{messageLogin}}</button>
          <div [hidden]="!newUser">
          <input maxlength="500" [(ngModel)]="passwordConfirm" name="passwordConfirm" type="password" placeholder="Confirm password *"/>
          <input maxlength="500" [(ngModel)]="firstName" style="text-transform: lowercase;"  name="firstName" type="text" placeholder="First name *"/>
          <input maxlength="500" [(ngModel)]="lastName" style="text-transform: lowercase;" name="lastName" type="text" placeholder="Last name *"/>
          <button type="button" (click)="register(email,password,passwordConfirm,firstName,lastName,photoURL)">Register {{messageRegister}}</button>
          </div>
          </div>
          <div [hidden]="!loggedIn">
          <button type="button" (click)="logout()">Logout {{messageLogout}}</button>
          <div [hidden]="emailVerified">
          <div style="font-size:10px">You need to verify your email address. An email has been sent to you. After clicking the link in the email, you need to logout and login to complete the setup.</div>
          <button type="button" (click)="sendEmailVerification()">Resend email verification {{messageVerification}}</button>
          </div>
          </div>
        </form>
      </div>
      <div class="cta"><a href='mailto:contactperrinn@gmail.com'>Contact PERRINN</a></div>
    </div>
  </div>
  `,
})

export class LoginComponent  {

  currentUserID: string;
  email: string;
  password: string;
  passwordConfirm: string;
  firstName: string;
  lastName: string;
  photoURL: string;
  message: string;
  messageRegister: string;
  messageVerification: string;
  messageLogout: string;
  messageLogin: string;
  loggedIn: boolean;
  emailVerified: boolean;
  newUser: boolean;

  constructor(
    public router: Router,
    public afAuth: AngularFireAuth,
    public db: AngularFireDatabase
  ) {
    this.photoURL="./../assets/App icons/me.png";
    this.newUser = false;
    this.afAuth.authState.subscribe((auth) => {
        if (auth == null) {
          this.currentUserID="";
          this.loggedIn = false;
          this.emailVerified = true;
          this.db.object('appSettings/').subscribe(appSettings=>{
            document.getElementById('login').style.backgroundImage = 'url(' + appSettings.loginBackgroundImage + ')';
          });
        }
        else {
          this.currentUserID=auth.uid;
          this.loggedIn = true;
          this.db.object('appSettings/').subscribe(appSettings=>{
            document.getElementById('login').style.backgroundImage = 'url(' + appSettings.loginBackgroundImage + ')';
          });
          if (!auth.emailVerified) {
            this.emailVerified = false;
          }
          else {
            this.emailVerified = true;
            this.router.navigate(['teamProfile']);
          }
        }
    });
  }

  login(email: string, password: string) {
    this.newUser = false;
    this.clearAllMessages ();
    this.afAuth.auth.signInWithEmailAndPassword(email, password)
    .then(_ => this.messageLogin="Successfully logged in")
    .catch(err => this.messageLogin="Error: Verify your email and password or create a new account");
  }

  logout() {
    this.clearAllMessages ();
    this.afAuth.auth.signOut()
    .then(_ => this.messageLogout="Successfully logged out")
    .catch(err => this.messageLogout="Error: You were not logged in");
  }

  register(email: string, password: string, passwordConfirm: string, firstName: string, lastName: string, photoURL: string) {
    this.newUser = false;
    this.clearAllMessages ();
    if (email==null||password==null||passwordConfirm==null||!(password==passwordConfirm)||firstName==null||lastName==null||photoURL==null) {
        this.messageRegister="Error: You need to fill all the fields";
    }
    else {
      firstName = firstName.toLowerCase();
      lastName = lastName.toLowerCase();
      this.afAuth.auth.createUserWithEmailAndPassword(email, password)
      .catch(err => this.messageRegister="Error: This email is already used or you haven't provided valid information")
      .then(_=> {
        this.afAuth.authState.subscribe((auth) => {
          this.db.object('users/' + auth.uid).update({firstName: firstName, lastName: lastName, photoURL: photoURL, createdTimestamp: firebase.database.ServerValue.TIMESTAMP})
          .catch(err => this.messageRegister="Error: We couldn't save your profile")
          .then(_ => {
            this.sendEmailVerification();
            this.messageRegister="Successful registered";
            var teamName = "team " + firstName;
            this.createNewTeam(auth.uid, teamName);
          });
        });
      });
    }
  }

  sendEmailVerification() {
    this.clearAllMessages ();
    firebase.auth().currentUser.sendEmailVerification()
    .then(_ => this.messageVerification="An email has been sent to you")
    .catch(err => this.messageVerification="Error: You need to login or register first");
  }

  createNewTeam(userID: string, teamName: string) {
    teamName = teamName.toUpperCase();
    var teamID = this.db.list('ids/').push(true).key;
    this.db.object('teamUsers/'+teamID+'/'+userID).update({member: true, leader: true});
    this.db.object('teams/'+teamID).update({name: teamName, organisation: "Family and Friends"});
    this.db.object('userTeams/'+userID+'/'+teamID).update({following: true, lastChatVisitTimestamp: firebase.database.ServerValue.TIMESTAMP});
    this.db.object('userInterface/' + userID).update({currentTeam: teamID});
  }

  clearAllMessages () {
    this.messageLogin = "";
    this.messageLogout = "";
    this.messageRegister = "";
    this.messageVerification = "";
  }

  errorHandler(event) {
    event.target.src = "https://static1.squarespace.com/static/5391fac1e4b07b6926545c34/t/54b948f4e4b0567044b6c023/1421428991081/";
  }

}
