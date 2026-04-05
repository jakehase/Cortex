export function createCouponStudioFixtures() {
  return {
    contacts: [
      { id: 'coupon-studio-contact-1', email: 'coupon.studio+1@example.com', tier: 'growth' },
      { id: 'coupon-studio-contact-2', email: 'coupon.studio+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'coupon-studio-ws-1', name: 'Coupon Studio Demo North' },
      { id: 'coupon-studio-ws-2', name: 'Coupon Studio Demo South' }
    ],
    notes: ['Expansion fixture for Coupon Studio', 'Supports test and catalog rendering']
  };
}

export function summarizeCouponStudioFixtures(fixtures = createCouponStudioFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
