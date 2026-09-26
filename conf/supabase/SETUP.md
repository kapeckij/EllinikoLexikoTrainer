# Supabase Setup

1. In Supabase SQL Editor, run `schema.sql`.
2. In Project Settings > API Keys, copy the publishable key and set `publishableKey` in `../../services/supabase-config.js`. Never use a secret or service-role key in the browser.
3. Create a Google OAuth Web application in Google Cloud. Add `http://localhost:8080` to Authorized JavaScript origins and the callback URL shown on Supabase's Google provider page to Authorized redirect URIs.
4. In Supabase Authentication > Sign In / Providers > Google, enable the provider and enter the Google Client ID and Client Secret.
5. Add `http://localhost:8080/**` to Supabase Authentication > URL Configuration > Redirect URLs. Add the deployed trainer URL there too when hosting it publicly.
6. Keep the Supabase project URL and Google client credentials configured in Supabase; only the publishable key belongs in the browser config.

The trainer starts in local-only mode until `publishableKey` is set. On first Google sign-in it asks whether to transfer browser state to the account. If an account already has cloud state and the browser differs, it asks whether to upload local state or download the cloud state.

After updating the key or OAuth settings, reload the trainer before testing sign-in.
