import { EnvironmentInjector, Injectable, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { BehaviorSubject, combineLatest, Subscription } from 'rxjs';

export interface AppPermissions { readonly uid: string; readonly isAdmin: boolean; readonly ready: boolean; }
/** UI permissions use real Auth tokens. Protected writes are also enforced by rules. */
@Injectable({ providedIn: 'root' })
export class PermissionsService implements OnDestroy {
  private readonly permissions = new BehaviorSubject<AppPermissions>({ uid: '', isAdmin: false, ready: false });
  readonly state = this.permissions.asObservable();
  private readonly subscription: Subscription;
  constructor(auth: AngularFireAuth, injector: EnvironmentInjector) {
    this.subscription = runInInjectionContext(injector, () => combineLatest([auth.authState, auth.idTokenResult]).subscribe({
      next: ([user, token]) => {
        const matches = !!user && token?.claims['sub'] === user.uid;
        this.permissions.next({ uid: user?.uid || '', isAdmin: matches && token?.claims['perrinnAdmin'] === true, ready: !user || matches });
      },
      error: () => this.permissions.next({ uid: '', isAdmin: false, ready: true })
    }));
  }
  get current() { return this.permissions.value; }
  ngOnDestroy() { this.subscription.unsubscribe(); this.permissions.complete(); }
}
