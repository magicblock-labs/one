// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://81551955b403808ca0d241b04b855620@o4511348334854144.ingest.us.sentry.io/4511370863181824",
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
