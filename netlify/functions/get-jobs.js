/**
 * get-jobs.js
 * Public GET endpoint: /.netlify/functions/get-jobs
 * Returns the latest jobs JSON that was saved by fetch-jobs.js
 * Called by the website frontend every page load + every 60 min
 */

import { getStore } from "@netlify/blobs";

export const handler = async () => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
  };

  try {
    const store = getStore({ name: "snh-jobs", consistency: "strong" });
    const data = await store.get("latest", { type: "json" });

    if (!data) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          updatedIST: "Fetching for first time...",
          totalJobs: 0,
          sourcesHit: 0,
          totalSources: 38,
          jobs: [],
          _empty: true,
        }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    console.error("get-jobs error:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, jobs: [] }),
    };
  }
};
