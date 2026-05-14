import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';

@Component({
  template: '',
})
class EmptyRouteComponent {}

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideRouter([
          { path: 'table-assistant', component: EmptyRouteComponent },
          { path: 'table-assistant/:id', component: EmptyRouteComponent },
          { path: 'games/:id', component: EmptyRouteComponent },
        ]),
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the router outlet host', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('keeps the global disclaimer on the table assistant setup page', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/table-assistant');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).not.toBeNull();
  });

  it('hides the global disclaimer inside a table assistant room', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/table-assistant/room-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).toBeNull();
  });

  it('hides the global disclaimer inside a game table', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/games/game-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).toBeNull();
  });
});
