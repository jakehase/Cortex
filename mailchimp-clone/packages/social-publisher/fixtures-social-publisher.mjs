export function createSocialPublisherFixtures() {
  return {
    contacts: [
      { id: 'social-publisher-contact-1', email: 'social.publisher+1@example.com', tier: 'growth' },
      { id: 'social-publisher-contact-2', email: 'social.publisher+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'social-publisher-ws-1', name: 'Social Publisher Demo East' },
      { id: 'social-publisher-ws-2', name: 'Social Publisher Demo West' }
    ],
    notes: ['Continuation fixture for Social Publisher', 'Supports regression catalog rendering']
  };
}

export function summarizeSocialPublisherFixtures(fixtures = createSocialPublisherFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}
