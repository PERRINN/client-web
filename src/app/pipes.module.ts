import { NgModule } from '@angular/core';
import { BlankIfZeroPipe, LinkyPipe } from './pipes';

@NgModule({
  imports: [],
  declarations: [
    BlankIfZeroPipe,
    LinkyPipe
  ],
  exports: [
    BlankIfZeroPipe,
    LinkyPipe
  ],
})
export class PipeModule {

  static forRoot() {
    return {
      ngModule: PipeModule,
      providers: [],
    };
  }
}
