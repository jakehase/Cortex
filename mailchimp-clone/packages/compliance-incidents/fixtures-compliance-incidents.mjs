export function createComplianceIncidentsFixtures() {
  return {
    contacts: [
      { id: "compliance-incidents-contact-1", email: "compliance-incidents+1@example.com", tier: 'growth' },
      { id: "compliance-incidents-contact-2", email: "compliance-incidents+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "compliance-incidents-ws-1", name: "Compliance Incidents Demo East" },
      { id: "compliance-incidents-ws-2", name: "Compliance Incidents Demo West" }
    ],
    notes: ["Compliance Incidents fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeComplianceIncidentsFixtures(fixtures = createComplianceIncidentsFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

