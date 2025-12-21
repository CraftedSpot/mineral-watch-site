// Force reprocess today's completions by clearing them from the cache
const NAMESPACE_ID = 'd39109ffa98d4f4d999ee37098d0c13e';

async function clearCompletionsFromCache() {
  console.log("This script will clear today's completions from the processed cache.");
  console.log("Run the following command to clear the cache and allow reprocessing:\n");
  
  console.log(`wrangler kv:key delete --namespace-id=${NAMESPACE_ID} "processed_apis"`);
  console.log("\nThen trigger the daily monitor with:");
  console.log(`curl -X POST -H "Authorization: Bearer test123" "https://mineral-watch-monitor.photog12.workers.dev/trigger/daily"`);
  
  console.log("\nThis will:");
  console.log("- Reprocess all of today's permits and completions");
  console.log("- Add the missing completion to Statewide Activity");
  console.log("- Check for alerts on your new property");
  console.log("- May create some duplicate permit records (which you can clean up)");
}

clearCompletionsFromCache();