export function createProfileEnrichmentFixtures() {
  return {
    contacts: [
      { id: "profile-enrichment-contact-1", email: "profile-enrichment+1@example.com", tier: 'growth' },
      { id: "profile-enrichment-contact-2", email: "profile-enrichment+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "profile-enrichment-ws-1", name: "Profile Enrichment Demo East" },
      { id: "profile-enrichment-ws-2", name: "Profile Enrichment Demo West" }
    ],
    notes: ["Profile Enrichment fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeProfileEnrichmentFixtures(fixtures = createProfileEnrichmentFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

