export function createBrandGovernanceFixtures() {
  return {
    contacts: [
      { id: 'brand-governance-contact-1', email: 'brand.governance+1@example.com', tier: 'growth' },
      { id: 'brand-governance-contact-2', email: 'brand.governance+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'brand-governance-ws-1', name: 'Brand Governance Demo North' },
      { id: 'brand-governance-ws-2', name: 'Brand Governance Demo South' }
    ],
    notes: ['Expansion fixture for Brand Governance', 'Supports test and catalog rendering']
  };
}

export function summarizeBrandGovernanceFixtures(fixtures = createBrandGovernanceFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
