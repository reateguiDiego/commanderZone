import { Directive } from '@angular/core';

@Directive({
  selector: '[appPrettyScroll]',
  host: {
    class: 'app-pretty-scroll',
  },
})
export class PrettyScrollDirective {}
