export function createOnboardingCenterFixtures() {
  return {
    contacts: [
      { id: 'onboarding-center-contact-1', email: 'onboarding.center+1@example.com', tier: 'growth' },
      { id: 'onboarding-center-contact-2', email: 'onboarding.center+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'onboarding-center-ws-1', name: 'Onboarding Center Demo North' },
      { id: 'onboarding-center-ws-2', name: 'Onboarding Center Demo South' }
    ],
    notes: ['Expansion fixture for Onboarding Center', 'Supports test and catalog rendering']
  };
}

export function summarizeOnboardingCenterFixtures(fixtures = createOnboardingCenterFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
