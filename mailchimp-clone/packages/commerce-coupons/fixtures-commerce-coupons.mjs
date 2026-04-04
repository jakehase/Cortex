export function createCommerceCouponsFixtures() {
  return {
    contacts: [
      { id: 'commerce-coupons-contact-1', email: 'commerce.coupons+1@example.com', tier: 'growth' },
      { id: 'commerce-coupons-contact-2', email: 'commerce.coupons+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'commerce-coupons-ws-1', name: 'Commerce Coupons Demo East' },
      { id: 'commerce-coupons-ws-2', name: 'Commerce Coupons Demo West' }
    ],
    notes: ['Continuation fixture for Commerce Coupons', 'Supports regression catalog rendering']
  };
}

export function summarizeCommerceCouponsFixtures(fixtures = createCommerceCouponsFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}
