export function createSegmentationQualityFixtures() {
  return {
    contacts: [
      { id: "segmentation-quality-contact-1", email: "segmentation-quality+1@example.com", tier: 'growth' },
      { id: "segmentation-quality-contact-2", email: "segmentation-quality+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "segmentation-quality-ws-1", name: "Segmentation Quality Demo East" },
      { id: "segmentation-quality-ws-2", name: "Segmentation Quality Demo West" }
    ],
    notes: ["Segmentation Quality fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeSegmentationQualityFixtures(fixtures = createSegmentationQualityFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

