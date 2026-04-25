import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  ArrowLeft,
  CheckCircle2,
  CircleUserRound,
  CreditCard,
  DoorOpen,
  KeyRound,
  Layers3,
  LogIn,
  LogOut,
  LucideAngularModule,
  MessageSquare,
  Play,
  Plus,
  RefreshCcw,
  RotateCw,
  Save,
  Search,
  Send,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-angular';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    importProvidersFrom(
      LucideAngularModule.pick({
        ArrowLeft,
        CheckCircle2,
        CircleUserRound,
        CreditCard,
        DoorOpen,
        KeyRound,
        Layers3,
        LogIn,
        LogOut,
        MessageSquare,
        Play,
        Plus,
        RefreshCcw,
        RotateCw,
        Save,
        Search,
        Send,
        Trash2,
        Upload,
        UserPlus,
      }),
    ),
  ]
};
