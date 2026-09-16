When survey core/score/attendance rules, catalog, Google reader, or sync worker change, rebuild the API runtime before deployment:

```sh
npx --yes esbuild@0.28.2 lib/survey-sync-runtime.mjs --bundle --platform=node --format=cjs --target=node20 --outfile=lib/survey-sync-runtime.cjs
node --test checkhere/tests/survey-sync.test.mjs
```

The generated bundle is server-only and is never loaded by the portal UI. It avoids the existing Vercel JS builder converting ESM imports to unsupported CommonJS require calls. The static survey catalog is included so the function has no runtime filesystem dependency.
