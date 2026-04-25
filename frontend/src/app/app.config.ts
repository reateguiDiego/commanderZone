import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  ArrowLeft,
  BarChart3,
  BookmarkPlus,
  Camera,
  CheckCircle2,
  CircleUserRound,
  Copy,
  DoorOpen,
  EyeOff,
  FileUp,
  History,
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
  SearchX,
  Send,
  ShieldCheck,
  Trash,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-angular';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { loadingInterceptor } from './core/loading/loading.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([loadingInterceptor, authInterceptor])),
    importProvidersFrom(
      LucideAngularModule.pick({
        ArrowLeft,
        BarChart3,
        BookmarkPlus,
        Camera,
        CheckCircle2,
        CircleUserRound,
        Copy,
        DoorOpen,
        EyeOff,
        FileUp,
        History,
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
        SearchX,
        Send,
        ShieldCheck,
        Trash,
        Trash2,
        Upload,
        UserPlus,
        X,
      }),
    ),
  ]
};
