export function createConsentLedgerFixtures() {
  return {
    contacts: [
      { id: "consent-ledger-contact-1", email: "consent-ledger+1@example.com", tier: 'growth' },
      { id: "consent-ledger-contact-2", email: "consent-ledger+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "consent-ledger-ws-1", name: "Consent Ledger Demo East" },
      { id: "consent-ledger-ws-2", name: "Consent Ledger Demo West" }
    ],
    notes: ["Consent Ledger fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeConsentLedgerFixtures(fixtures = createConsentLedgerFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

