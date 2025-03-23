import { Component } from '@angular/core';
import { Router } from '@angular/router';
import firebase from 'firebase/compat/app';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';

@Component({
  selector:'login',
  template:`
  <div id="login">
    <div class="module form-module" style="max-width:450px">
      <div class="form">
        <form #f="ngForm">
          <div class="buttonBlack" [hidden]="action=='register'" style="font-size:12px;line-height:15px;width:150px;padding:4px;margin:10px auto" (click)="action='register';messageUser=''">New member</div>
          <div class="buttonBlack" [hidden]="action=='login'" style="font-size:12px;line-height:15px;width:150px;padding:4px;margin:10px auto" (click)="action='login';messageUser=''">Existing member</div>
          <div *ngIf="action=='login'">
            <input maxlength="500" [(ngModel)]="email" name="email" type="text" placeholder="Email *" (keyup)="messageUser=''" autofocus required #e="ngModel"/>
            <input maxlength="500" [(ngModel)]="password" name="password" type="password" placeholder="Password *" (keyup)="messageUser=''" required #p="ngModel"/>
            <button class="buttonWhite" style="font-size:14px;line-height:25px;width:200px;padding:4px;margin:10px auto" (click)="login(email,password)" [disabled]="f.invalid">Login</button>
            <div class="buttonBlack" style="width:125px;font-size:10px;margin:10px auto" (click)="resetPassword(email)">Forgot password?</div>
            <div *ngIf="e.invalid && e.touched && messageUser == null || p.invalid && p.touched && messageUser == null" class="alertGreen">
              Enter your email & password, then click on "Login".
              <br/> <br/> New here? Click on "New member" to create an account.
            </div>
            <div *ngIf="messageUser == 'An email has been sent to you.'" class="alertGreen">{{messageUser}}</div>
            <div *ngIf="messageUser == 'Firebase: Error (auth/missing-email).'" class="alertBlue">Please write your email above, then click on "Forgot password?" to receive a link to reset it.</div>
            <div *ngIf="messageUser == 'Firebase: The email address is badly formatted. (auth/invalid-email).'" class="alertRed">Please enter a valid email address to log in or to reset your password.</div>
            <div *ngIf="messageUser && messageUser !== 'An email has been sent to you.' && messageUser !== 'Firebase: Error (auth/missing-email).' && messageUser !== 'Firebase: The email address is badly formatted. (auth/invalid-email).'" class="alertRed">{{messageUser}}</div>
            <div *ngIf="messageUser == 'Firebase: The email address is badly formatted. (auth/invalid-email).' || messageUser == 'Firebase: There is no user record corresponding to this identifier. The user may have been deleted. (auth/user-not-found).' || messageUser == 'Wrong password.'" class="alertGreen">New here? Click on "New member" to create an account.</div>
          </div>
          <div *ngIf="action=='register'">
            <input maxlength="500" [(ngModel)]="email" name="email" type="text" placeholder="Email *" (keyup)="messageUser=''" autofocus required #e="ngModel"/>
            <input maxlength="500" [(ngModel)]="password" name="password" type="password" placeholder="Password *" (keyup)="messageUser=''" required #p="ngModel"/>
            <input maxlength="500" [(ngModel)]="passwordConfirm" name="passwordConfirm" type="password" placeholder="Confirm password *" (keyup)="messageUser=''" #c="ngModel" required/>
            <input maxlength="500" [(ngModel)]="name" name="name" type="text" placeholder="First name (one word) *" (keyup)="messageUser=''" #n="ngModel" pattern="[A-Za-z0-9]{2,}" required/>
            <button type="button" class="buttonWhite" style="font-size:14px;text-align:center;line-height:25px;width:200px;padding:4px;margin:10px auto" (click)="register(email,password,passwordConfirm,name)" [disabled]="f.invalid">Register</button>
            <div *ngIf="e.invalid && e.touched || p.invalid && p.touched || c.invalid && c.touched || n.invalid && n.errors.required && n.touched" class="alertGreen">
              You need to fill all the fields.
            </div>
            <div *ngIf="n.invalid && n.errors.pattern && n.touched" class="alertGreen">
              You need to write your first name in one word. 
              <br/>
              (letters & numbers)
            </div>
            <div *ngIf="messageUser" class="alertRed">{{messageUser}}</div>
          </div>
        </form>
      </div>
    </div>
  </div>
  `,
})

export class LoginComponent  {

  email:string
  password:string
  passwordConfirm:string
  name:string
  message:string
  messageUser:string
  action:string

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService
  ) {
    this.action='login'
    this.afAuth.user.subscribe((auth) => {
      if (auth != null) {
        this.router.navigate(['profile','all'])
      }
    })
  }

  login(email:string, password:string) {
    this.afAuth.signInWithEmailAndPassword(email, password).catch((error) => {
      const errorCode = error.code;
      const errorMessage = error.message;
      if (errorCode === 'auth/wrong-password') {
        this.messageUser = 'Wrong password.';
      } else {
        this.messageUser = errorMessage;
      }
    });
  }

  resetPassword(email:string) {
    this.afAuth.sendPasswordResetEmail(email)
    .then(_ => this.messageUser = 'An email has been sent to you.')
    .catch((error) => {
      const errorCode = error.code;
      const errorMessage = error.message;
      this.messageUser = errorMessage;
    });
  }

  logout() {
    this.afAuth.signOut()
    .then(_ => this.messageUser = 'Successfully logged out.')
    .catch(err => this.messageUser = 'You were not logged in.');
  }

  register(email:string,password:string,passwordConfirm:string,name:string) {
    if (password != passwordConfirm) {
      this.messageUser = 'Verification password doesn\'t match.';
    } else {
      this.afAuth.createUserWithEmailAndPassword(email, password).catch((error) => {
        const errorCode = error.code;
        const errorMessage = error.message;
        if (errorCode == 'auth/weak-password') {
          this.messageUser = 'The password is too weak.';
        } else {
          this.messageUser = errorMessage;
        }
      }).then(_ => {
        this.afAuth.user.subscribe((auth) => {
          const imageUrlThumb="https://storage.googleapis.com/perrinn-d5fc1.appspot.com/images%2F1709995468152Screenshot%202024-03-09%20at%2014.43.03_180x180.png?GoogleAccessId=firebase-adminsdk-rh8x2%40perrinn-d5fc1.iam.gserviceaccount.com&Expires=16756761600&Signature=GKQ%2Fz0M3pXzE0SZ9QfO5lnCkVGj783QypOyNsY4HCsw%2BSL7pH%2BLddtU0DSIUyK6gpCYxUiUtzI%2BtWkOU724UOONPdMGtHOLI7XabCq%2Bi5q6hHTjqSKL%2FA07o60KjdwrGDRFCiUzIuTvlqhLDvqPA0rQAUBnIynOu8lP06KbTglVTixEYjX0TsVJzP7Epl3HGE36f1EoRwEPgx4S4WI86u25KKBDu7mIU7uYfUlc3bJqan%2FCMnODMwu6VwDrrjA7E1lCSZw%2BOi7%2B3cdONQShPxd%2Ftnb0XxgHnwgnQCfDj1flydLDPWcwqypnguN8%2B%2B%2FLKgLKh6kw9CvKP758GZxndbA%3D%3D";
          const imageUrlMedium="https://storage.googleapis.com/perrinn-d5fc1.appspot.com/images%2F1709995468152Screenshot%202024-03-09%20at%2014.43.03_540x540.png?GoogleAccessId=firebase-adminsdk-rh8x2%40perrinn-d5fc1.iam.gserviceaccount.com&Expires=16756761600&Signature=QK2IPbdPs3B19q4Ydmh4JNllBQGxqLAz0Rq4oXaqC1rw9yQsd0K%2BD9szMRFHh6wsuUksoyACoXd8pISiJuQVX1adtUuOn5OjaITySDJPETAkgiND6kF0%2F8BD8qLcGglaKpcPE9ObXTh7ZJizpu8lruF63fPs3lZWHNkggV%2BHcMw%2B3qij2EFxxneSWbG7YpFce9%2BYm%2FrwQ2qUwuOxWD1JiAP9hNHkbfrGqroJxchMxRZlsowwklOpVL9VSXf9Z57puTH6pbrQAJJOxTce1lY9c%2FSGWkSeJqLfb3wUPwahLp5NKV1t4PG6gJ%2FY4YLOUpzemWb%2FRXAgtPJqzRIP7dyhkw%3D%3D";
          const imageUrlOriginal="https://firebasestorage.googleapis.com/v0/b/perrinn-d5fc1.appspot.com/o/images%2F1709995468152Screenshot%202024-03-09%20at%2014.43.03.png?alt=media&token=910a5063-ef2b-44e7-8d5d-d6468d23b44c";
          this.UI.createMessage({
            chain:auth.uid,
            creatingUser:true,
            text:'Creating member '+name,
            name:name,
            imageUrlThumbUser:imageUrlThumb,
            imageUrlMedium:imageUrlMedium,
            imageUrlOriginal:imageUrlOriginal
          })
        });
      });
    }
  }

}
