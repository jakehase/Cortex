export { registerPreferencesCenterRoutes } from './routes/preferences-center.mjs';
export {
  PREFERENCE_CENTER_RUNTIME_CONTRACT,
  buildPreferenceRuntimeSnapshot,
  createPreferenceCenter,
  createPreferenceExportRun,
  createPreferenceProfile,
  persistPreferenceRuntimeSnapshot,
  reconcilePreferenceSuppressions,
  recordPreferenceConsentEvent,
  updatePreferenceProfile,
  verifyPreferenceDoubleOptIn,
  preferenceSummary
} from './domain-preferences-center.mjs';
