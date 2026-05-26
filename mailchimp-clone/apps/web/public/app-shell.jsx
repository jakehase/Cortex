export * from './app-shell-client.mjs';
import { attachMailcloneClientShell } from './app-shell-client.mjs';

if (typeof document !== 'undefined') {
  attachMailcloneClientShell(document);
}
