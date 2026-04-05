import { createPartnerExchangeWorkspace, summarizePartnerExchange } from '../domain-partner-exchange.mjs';

export function createPartnerExchangeDashboardRoutes(basePath = '/partner-exchange') {
  const workspace = createPartnerExchangeWorkspace();
  const summary = summarizePartnerExchange(workspace);
  return [
    { id: 'partner-exchange.home', method: 'GET', path: basePath, summary },
    { id: 'partner-exchange.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: 'partner-exchange.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
