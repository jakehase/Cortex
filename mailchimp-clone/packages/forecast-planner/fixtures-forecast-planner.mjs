export function createForecastPlannerFixtures() {
  return {
    contacts: [
      { id: 'forecast-planner-contact-1', email: 'forecast.planner+1@example.com', tier: 'growth' },
      { id: 'forecast-planner-contact-2', email: 'forecast.planner+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'forecast-planner-ws-1', name: 'Forecast Planner Demo North' },
      { id: 'forecast-planner-ws-2', name: 'Forecast Planner Demo South' }
    ],
    notes: ['Expansion fixture for Forecast Planner', 'Supports test and catalog rendering']
  };
}

export function summarizeForecastPlannerFixtures(fixtures = createForecastPlannerFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
