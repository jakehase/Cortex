export function createSegmentationLabFixtures() {
  return {
    contacts: [
      { id: 'segmentation-lab-contact-1', email: 'segmentation.lab+1@example.com', tier: 'growth' },
      { id: 'segmentation-lab-contact-2', email: 'segmentation.lab+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'segmentation-lab-ws-1', name: 'Segmentation Lab Demo North' },
      { id: 'segmentation-lab-ws-2', name: 'Segmentation Lab Demo South' }
    ],
    notes: ['Expansion fixture for Segmentation Lab', 'Supports test and catalog rendering']
  };
}

export function summarizeSegmentationLabFixtures(fixtures = createSegmentationLabFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
