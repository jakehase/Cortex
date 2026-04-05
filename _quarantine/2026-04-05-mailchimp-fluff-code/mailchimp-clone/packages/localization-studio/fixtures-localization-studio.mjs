export function createLocalizationStudioFixtures() {
  return {
    contacts: [
      { id: 'localization-studio-contact-1', email: 'localization.studio+1@example.com', tier: 'growth' },
      { id: 'localization-studio-contact-2', email: 'localization.studio+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'localization-studio-ws-1', name: 'Localization Studio Demo North' },
      { id: 'localization-studio-ws-2', name: 'Localization Studio Demo South' }
    ],
    notes: ['Expansion fixture for Localization Studio', 'Supports test and catalog rendering']
  };
}

export function summarizeLocalizationStudioFixtures(fixtures = createLocalizationStudioFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
