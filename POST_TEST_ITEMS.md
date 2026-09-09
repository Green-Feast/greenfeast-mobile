# Post-Test Items

Things deferred until after closed testing / not blocking initial rollout.

- **Enable R8/ProGuard + upload deobfuscation mapping file** — Play Console
  warned that this build has no deobfuscation file. Non-blocking (JS crashes
  are already captured via Sentry), but enabling minification would shrink
  the app size and make native crash/ANR traces readable in Play Console.
  Play Console's App optimization report backs this up — "App optimization"
  is rated **Low**, with **Optimization percentage: -**, **Obfuscation
  percentage: 2%**, **Shrinking percentage: -**, and **R8 configuration: -**
  (Play suggests upgrading to AGP 9.0 to use R8 for best performance). Same
  fix as above covers this — enable R8/minification in the Android gradle
  config and rebuild.
- **Set `SENTRY_AUTH_TOKEN`** — currently unset, so Sentry stack traces are
  minified instead of de-obfuscated. Add later for more readable error
  reports; not blocking crash capture itself.
- **iOS App Store submission** — App Store Connect record creation,
  production build via `eas submit`, TestFlight setup — not started yet.
