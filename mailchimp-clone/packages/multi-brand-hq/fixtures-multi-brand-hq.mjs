export function createMultiBrandHqFixtures() {
  return {
    contacts: [
      { id: 'multi-brand-hq-contact-1', email: 'multi.brand.hq+1@example.com', tier: 'growth' },
      { id: 'multi-brand-hq-contact-2', email: 'multi.brand.hq+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'multi-brand-hq-ws-1', name: 'Multi Brand Hq Demo North' },
      { id: 'multi-brand-hq-ws-2', name: 'Multi Brand Hq Demo South' }
    ],
    notes: ['Expansion fixture for Multi Brand Hq', 'Supports test and catalog rendering']
  };
}

export function summarizeMultiBrandHqFixtures(fixtures = createMultiBrandHqFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
