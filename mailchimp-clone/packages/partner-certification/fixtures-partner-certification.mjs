export function createPartnerCertificationFixtures() {
  return {
    contacts: [
      { id: "partner-certification-contact-1", email: "partner-certification+1@example.com", tier: 'growth' },
      { id: "partner-certification-contact-2", email: "partner-certification+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "partner-certification-ws-1", name: "Partner Certification Demo East" },
      { id: "partner-certification-ws-2", name: "Partner Certification Demo West" }
    ],
    notes: ["Partner Certification fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizePartnerCertificationFixtures(fixtures = createPartnerCertificationFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

