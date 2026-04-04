export function createReferralEngineFixtures() {
  return {
    contacts: [
      { id: 'referral-engine-contact-1', email: 'referral.engine+1@example.com', tier: 'growth' },
      { id: 'referral-engine-contact-2', email: 'referral.engine+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'referral-engine-ws-1', name: 'Referral Engine Demo North' },
      { id: 'referral-engine-ws-2', name: 'Referral Engine Demo South' }
    ],
    notes: ['Expansion fixture for Referral Engine', 'Supports test and catalog rendering']
  };
}

export function summarizeReferralEngineFixtures(fixtures = createReferralEngineFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
