export function createPartnerOnboardingFixtures() {
  return {
    contacts: [
      { id: 'partner-onboarding-contact-1', email: 'partner.onboarding+1@example.com', tier: 'growth' },
      { id: 'partner-onboarding-contact-2', email: 'partner.onboarding+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'partner-onboarding-ws-1', name: 'Partner Onboarding Demo East' },
      { id: 'partner-onboarding-ws-2', name: 'Partner Onboarding Demo West' }
    ],
    notes: ['Continuation fixture for Partner Onboarding', 'Supports regression catalog rendering']
  };
}

export function summarizePartnerOnboardingFixtures(fixtures = createPartnerOnboardingFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}
