import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app/app';

export function bootstrapCommanderZoneApp(): Promise<unknown> {
  return bootstrapApplication(App, appConfig);
}
