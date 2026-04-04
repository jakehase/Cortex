export function createTemplateMarketplaceFixtures() {
  return {
    contacts: [
      { id: 'template-marketplace-contact-1', email: 'template.marketplace+1@example.com', tier: 'growth' },
      { id: 'template-marketplace-contact-2', email: 'template.marketplace+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'template-marketplace-ws-1', name: 'Template Marketplace Demo North' },
      { id: 'template-marketplace-ws-2', name: 'Template Marketplace Demo South' }
    ],
    notes: ['Expansion fixture for Template Marketplace', 'Supports test and catalog rendering']
  };
}

export function summarizeTemplateMarketplaceFixtures(fixtures = createTemplateMarketplaceFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
