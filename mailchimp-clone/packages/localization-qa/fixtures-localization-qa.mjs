export function createLocalizationQaFixtures() {
  return {
    contacts: [
      { id: "localization-qa-contact-1", email: "localization-qa+1@example.com", tier: 'growth' },
      { id: "localization-qa-contact-2", email: "localization-qa+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "localization-qa-ws-1", name: "Localization QA Demo East" },
      { id: "localization-qa-ws-2", name: "Localization QA Demo West" }
    ],
    notes: ["Localization QA fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeLocalizationQaFixtures(fixtures = createLocalizationQaFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

