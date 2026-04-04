export function createBillingRecoveryFixtures() {
  return {
    contacts: [
      { id: 'billing-recovery-contact-1', email: 'billing.recovery+1@example.com', tier: 'growth' },
      { id: 'billing-recovery-contact-2', email: 'billing.recovery+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'billing-recovery-ws-1', name: 'Billing Recovery Demo East' },
      { id: 'billing-recovery-ws-2', name: 'Billing Recovery Demo West' }
    ],
    notes: ['Continuation fixture for Billing Recovery', 'Supports regression catalog rendering']
  };
}

export function summarizeBillingRecoveryFixtures(fixtures = createBillingRecoveryFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}
