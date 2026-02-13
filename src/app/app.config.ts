import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { BrowserModule, provideClientHydration } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideYConfig, YConfig } from 'angular-yandex-maps-v3';
const config: YConfig = {
  apikey: '042405c2-12f5-4b78-9580-cb5ea1d7c106',
  lang:'ru_RU'
};
export const appConfig: ApplicationConfig = {
  providers: [
     provideYConfig(config),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
     provideHttpClient(),
      importProvidersFrom(BrowserModule),
    provideClientHydration(),
    {
      provide: 'BASE_HREF',
      useFactory: () => {
        const baseElement = document.querySelector('base');
        return baseElement ? baseElement.getAttribute('href') || '/' : '/';
      }
    }

  ]
};
