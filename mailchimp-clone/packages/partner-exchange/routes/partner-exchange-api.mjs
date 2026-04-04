import { createPartnerExchangeBrief, validatePartnerExchangePlan } from '../domain-partner-exchange.mjs';

export function createPartnerExchangeApiRoutes(basePath = '/api/partner-exchange') {
  const sample = createPartnerExchangeBrief();
  return [
    { id: 'partner-exchange.brief', method: 'POST', path: basePath + '/brief', sample },
    { id: 'partner-exchange.validate', method: 'POST', path: basePath + '/validate', validation: validatePartnerExchangePlan(sample) }
  ];
}
