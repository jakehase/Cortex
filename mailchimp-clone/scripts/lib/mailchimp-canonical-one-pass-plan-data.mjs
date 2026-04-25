export const MAILCHIMP_CANONICAL_ONE_PASS_PLAN = {
  "generatedAt": "2026-04-12T01:32:10.528Z",
  "surfaceChecklist": [
    {
      "id": "signup_onboarding",
      "label": "Signup and onboarding wizard",
      "priority": "P0",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_1_core_funnel_and_audience",
      "productFiles": [
        "packages/app/index.mjs",
        "packages/app/routes/public.mjs",
        "packages/app/routes/platform.mjs",
        "packages/app/view.mjs"
      ],
      "targetedTests": [
        "tests/platform-spine.test.mjs",
        "tests/current-product-parity.test.mjs"
      ]
    },
    {
      "id": "account_workspace_setup",
      "label": "Account workspace setup",
      "priority": "P0",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_1_core_funnel_and_audience",
      "productFiles": [
        "packages/app/index.mjs",
        "packages/app/routes/platform.mjs",
        "packages/app/view.mjs"
      ],
      "targetedTests": [
        "tests/platform-spine.test.mjs"
      ]
    },
    {
      "id": "dashboard_home",
      "label": "Dashboard / home",
      "priority": "P1",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_1_core_funnel_and_audience",
      "productFiles": [
        "packages/app/index.mjs",
        "packages/app/view.mjs",
        "packages/app/routes/platform.mjs"
      ],
      "targetedTests": [
        "tests/platform-spine.test.mjs",
        "tests/parity-route-aliases.test.mjs"
      ]
    },
    {
      "id": "audience_overview",
      "label": "Audience overview",
      "priority": "P0",
      "currentStatus": "observed_direct",
      "wave": "wave_1_core_funnel_and_audience",
      "productFiles": [
        "packages/app/domain-audience.mjs",
        "packages/app/routes/audience.mjs"
      ],
      "targetedTests": [
        "tests/audience-core.test.mjs"
      ]
    },
    {
      "id": "contacts_table",
      "label": "Contacts table",
      "priority": "P0",
      "currentStatus": "observed_direct",
      "wave": "wave_1_core_funnel_and_audience",
      "productFiles": [
        "packages/app/domain-audience.mjs",
        "packages/app/routes/audience.mjs"
      ],
      "targetedTests": [
        "tests/audience-core.test.mjs"
      ]
    },
    {
      "id": "contact_profile",
      "label": "Contact profile",
      "priority": "P0",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_1_core_funnel_and_audience",
      "productFiles": [
        "packages/app/domain-audience.mjs",
        "packages/app/routes/audience.mjs"
      ],
      "targetedTests": [
        "tests/audience-core.test.mjs"
      ]
    },
    {
      "id": "tags_groups_interests",
      "label": "Tags, groups, and interests management",
      "priority": "P1",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_1_core_funnel_and_audience",
      "productFiles": [
        "packages/app/domain-audience.mjs",
        "packages/app/routes/audience.mjs"
      ],
      "targetedTests": [
        "tests/audience-core.test.mjs",
        "tests/audience-funnels.test.mjs"
      ]
    },
    {
      "id": "segments",
      "label": "Segments",
      "priority": "P0",
      "currentStatus": "observed_direct",
      "wave": "wave_1_core_funnel_and_audience",
      "productFiles": [
        "packages/app/domain-audience.mjs",
        "packages/app/routes/audience.mjs"
      ],
      "targetedTests": [
        "tests/audience-funnels.test.mjs"
      ]
    },
    {
      "id": "signup_forms_popups",
      "label": "Signup forms and popup forms",
      "priority": "P1",
      "currentStatus": "observed_direct",
      "wave": "wave_2_campaign_authoring_content_and_send",
      "productFiles": [
        "packages/app/routes/forms.mjs",
        "packages/app/domain-growth.mjs"
      ],
      "targetedTests": [
        "tests/forms-landing.test.mjs"
      ]
    },
    {
      "id": "campaign_index",
      "label": "Campaign index",
      "priority": "P0",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_2_campaign_authoring_content_and_send",
      "productFiles": [
        "packages/app/domain-campaigns.mjs",
        "packages/app/routes/campaigns.mjs"
      ],
      "targetedTests": [
        "tests/campaign-editor-depth.test.mjs"
      ]
    },
    {
      "id": "campaign_wizard",
      "label": "Campaign creation wizard",
      "priority": "P0",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_2_campaign_authoring_content_and_send",
      "productFiles": [
        "packages/app/domain-campaigns.mjs",
        "packages/app/routes/campaigns.mjs"
      ],
      "targetedTests": [
        "tests/campaign-editor-depth.test.mjs",
        "tests/current-product-parity.test.mjs"
      ]
    },
    {
      "id": "email_builder",
      "label": "Email builder",
      "priority": "P0",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_2_campaign_authoring_content_and_send",
      "productFiles": [
        "packages/app/routes/content-asset-templates.mjs",
        "packages/app/domain-campaigns.mjs"
      ],
      "targetedTests": [
        "tests/campaign-editor-depth.test.mjs"
      ]
    },
    {
      "id": "template_library",
      "label": "Template library",
      "priority": "P1",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_2_campaign_authoring_content_and_send",
      "productFiles": [
        "packages/app/routes/content-asset-templates.mjs",
        "packages/app/domain-template-assets.mjs"
      ],
      "targetedTests": [
        "tests/template-variants-routes.test.mjs",
        "tests/template-approvals-routes.test.mjs"
      ]
    },
    {
      "id": "content_studio",
      "label": "Content studio / asset manager",
      "priority": "P1",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_2_campaign_authoring_content_and_send",
      "productFiles": [
        "packages/app/routes/content-asset-templates.mjs",
        "packages/app/domain-content-ecosystem-depth.mjs"
      ],
      "targetedTests": [
        "tests/content-library.test.mjs",
        "tests/current-product-parity.test.mjs"
      ]
    },
    {
      "id": "send_schedule_review",
      "label": "Send / schedule / review",
      "priority": "P0",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_2_campaign_authoring_content_and_send",
      "productFiles": [
        "packages/app/domain-campaigns.mjs",
        "packages/app/routes/campaigns.mjs"
      ],
      "targetedTests": [
        "tests/campaign-editor-depth.test.mjs"
      ]
    },
    {
      "id": "reports_overview",
      "label": "Reports overview",
      "priority": "P0",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_3_reporting_automation_and_growth",
      "productFiles": [
        "packages/app/routes/reports.mjs",
        "packages/app/routes/api-admin.mjs"
      ],
      "targetedTests": [
        "tests/reports-admin.test.mjs",
        "tests/billing-analytics.test.mjs"
      ]
    },
    {
      "id": "report_detail",
      "label": "Report detail",
      "priority": "P1",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_3_reporting_automation_and_growth",
      "productFiles": [
        "packages/app/routes/reports.mjs",
        "packages/app/domain-campaigns.mjs"
      ],
      "targetedTests": [
        "tests/reports-admin.test.mjs",
        "tests/current-product-parity.test.mjs"
      ]
    },
    {
      "id": "automations_overview",
      "label": "Automations overview",
      "priority": "P1",
      "currentStatus": "observed_direct",
      "wave": "wave_3_reporting_automation_and_growth",
      "productFiles": [
        "packages/app/routes/automations.mjs",
        "packages/app/domain-campaigns.mjs"
      ],
      "targetedTests": [
        "tests/automation-journeys.test.mjs"
      ]
    },
    {
      "id": "automation_journey_builder",
      "label": "Customer journey / automation builder",
      "priority": "P0",
      "currentStatus": "observed_direct",
      "wave": "wave_3_reporting_automation_and_growth",
      "productFiles": [
        "packages/app/routes/automations.mjs",
        "packages/app/domain-campaigns.mjs"
      ],
      "targetedTests": [
        "tests/automation-journeys.test.mjs"
      ]
    },
    {
      "id": "landing_pages",
      "label": "Landing pages",
      "priority": "P1",
      "currentStatus": "observed_direct",
      "wave": "wave_3_reporting_automation_and_growth",
      "productFiles": [
        "packages/app/routes/website-builder.mjs"
      ],
      "targetedTests": [
        "tests/forms-landing.test.mjs"
      ]
    },
    {
      "id": "website_builder",
      "label": "Website builder",
      "priority": "P1",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_3_reporting_automation_and_growth",
      "productFiles": [
        "packages/app/domain-website-builder.mjs"
      ],
      "targetedTests": [
        "tests/current-product-parity.test.mjs"
      ]
    },
    {
      "id": "integrations_marketplace",
      "label": "Integrations marketplace",
      "priority": "P2",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_4_admin_integrations_revenue_and_governance",
      "productFiles": [
        "packages/app/routes/integrations-marketplace.mjs",
        "packages/app/domain-integration-marketplace.mjs"
      ],
      "targetedTests": [
        "tests/integrations-marketplace.test.mjs"
      ]
    },
    {
      "id": "api_keys_webhooks",
      "label": "API keys and webhooks",
      "priority": "P2",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_4_admin_integrations_revenue_and_governance",
      "productFiles": [
        "packages/app/routes/api-admin.mjs"
      ],
      "targetedTests": [
        "tests/reports-admin.test.mjs"
      ]
    },
    {
      "id": "billing_plans",
      "label": "Billing and plans",
      "priority": "P2",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_4_admin_integrations_revenue_and_governance",
      "productFiles": [
        "packages/app/routes/api-admin.mjs",
        "packages/app/domain-commerce-revenue.mjs"
      ],
      "targetedTests": [
        "tests/billing-analytics.test.mjs"
      ]
    },
    {
      "id": "settings_domains",
      "label": "Settings, domains, and authentication",
      "priority": "P1",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_4_admin_integrations_revenue_and_governance",
      "productFiles": [
        "packages/app/routes/api-admin.mjs",
        "packages/app/routes/platform.mjs"
      ],
      "targetedTests": [
        "tests/security-ops-hardening.test.mjs",
        "tests/platform-spine.test.mjs"
      ]
    },
    {
      "id": "team_roles_permissions",
      "label": "Team users, roles, and permissions",
      "priority": "P1",
      "currentStatus": "partial_or_shallow",
      "wave": "wave_4_admin_integrations_revenue_and_governance",
      "productFiles": [
        "packages/app/routes/api-admin.mjs",
        "packages/app/routes/platform.mjs"
      ],
      "targetedTests": [
        "tests/platform-spine.test.mjs"
      ]
    }
  ],
  "laneBundles": [
    {
      "id": "wave_1_core_funnel_and_audience",
      "title": "Core funnel, workspace bootstrap, and audience management",
      "laneIds": null
    },
    {
      "id": "wave_2_campaign_authoring_content_and_send",
      "title": "Campaign authoring, content systems, forms, and send/review",
      "laneIds": null
    },
    {
      "id": "wave_3_reporting_automation_and_growth",
      "title": "Reporting, automations, landing pages, and growth surfaces",
      "laneIds": null
    },
    {
      "id": "wave_4_admin_integrations_revenue_and_governance",
      "title": "Integrations, developer/admin tooling, billing, settings, and team governance",
      "laneIds": null
    }
  ]
};
