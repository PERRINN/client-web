import { Pipe, PipeTransform } from '@angular/core'

@Pipe({name:'blankIfZero'})
export class BlankIfZeroPipe implements PipeTransform {
  transform(value:any):string{
    let newValue=value==0?'':value.toString()
    return newValue
  }
}
