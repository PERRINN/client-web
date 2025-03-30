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
          <div *ngIf="action=='login' || action=='register'">
            <input maxlength="500" [(ngModel)]="email" name="email" type="text" placeholder="Email *" (keyup)="messageUser=''" autofocus required #e="ngModel"/>
            <label class="password">
              <input maxlength="500" [(ngModel)]="password" name="password" [type]="passwordVisibility" [style]="focusPassword" placeholder="Password *" (keyup)="messageUser=''" required #p="ngModel"/>
              <div class="password-icon" (mousedown)="toggleField('password','show')" (touchstart)="toggleField('password','show')" (mouseup)="toggleField('password','hide')" (touchend)="toggleField('password','hide')">
                <span class="material-icons-outlined" id="visibility-outlined" [style]="iconOutlined">visibility</span>
                <span class="material-icons" id="visibility" [style]="icon">visibility</span>
              </div>
            </label>
          </div>
          <div *ngIf="action=='login'">
            <button class="buttonWhite" style="font-size:14px;line-height:25px;width:200px;padding:4px;margin:10px auto" (click)="login(email,password)" [disabled]="f.invalid">Login</button>
            <div class="buttonBlack" style="width:125px;font-size:10px;margin:10px auto" (click)="resetPassword(email)">Forgot password?</div>
          </div>
          <div *ngIf="action=='register'">
            <label class="password">
              <input maxlength="500" [(ngModel)]="passwordConfirm" name="passwordConfirm" [type]="passwordConfirmVisibility" [style]="focusPasswordConfirm" type="password" placeholder="Confirm password *" (keyup)="messageUser=''" #c="ngModel" required/>
              <div class="password-icon" (mousedown)="toggleField('passwordConfirm','show')" (touchstart)="toggleField('passwordConfirm','show')" (mouseup)="toggleField('passwordConfirm','hide')" (touchend)="toggleField('passwordConfirm','hide')">
                <span class="material-icons-outlined" id="visibilityConfirm-outlined" [style]="iconOutlinedConfirm">visibility</span>
                <span class="material-icons" id="visibilityConfirm" [style]="iconConfirm">visibility</span>
              </div>
            </label>
            <input maxlength="500" [(ngModel)]="name" name="name" type="text" placeholder="First name (one word) *" (keyup)="messageUser=''" #n="ngModel" pattern="[A-Za-z0-9]{2,}" required/>
            <button type="button" class="buttonWhite" style="font-size:14px;text-align:center;line-height:25px;width:200px;padding:4px;margin:10px auto" (click)="register(email,password,passwordConfirm,name)" [disabled]="f.invalid">Register</button>
          </div>
            <div *ngIf="messageUser" style="text-align:center;padding:10px;color:#D85140">{{messageUser}}</div>
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
  passwordVisibility:string = "password"
  passwordConfirmVisibility:string = "password"
  iconOutlined:string = "display:block"
  icon:string = "display:none"
  iconOutlinedConfirm:string = "display:block"
  iconConfirm:string = "display:none"
  focusPassword:string
  focusPasswordConfirm:string

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
        this.messageUser = 'Wrong password';
      } else {
        this.messageUser = errorMessage;
      }
    });
  }

  toggleField(field:string, effect:string) {
    if (field === 'password'){
      [this.passwordVisibility,this.iconOutlined,this.icon,this.focusPassword] = this.UI.fieldShowHide(effect);
    }
    else if (field === 'passwordConfirm'){
      [this.passwordConfirmVisibility,this.iconOutlinedConfirm,this.iconConfirm,this.focusPasswordConfirm] = this.UI.fieldShowHide(effect);
    }
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
