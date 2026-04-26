/**
 * get-jobs.js — v2
 * Serves latest jobs to the website frontend
 */

import { getStore } from "@netlify/blobs";

export const handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  };

  try {
    const store = getStore({
      name: "snh-jobs",
      siteID: process.env.SITE_ID || context?.site?.id,
      token: process.env.NETLIFY_BLOBS_CONTEXT || process.env.TOKEN,
      consistency: "strong",
    });

    const data = await store.get("latest", { type: "json" });

    if (!data) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          updatedIST: "Not yet fetched — trigger fetch-jobs first",
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
      statusCode: 200,
      headers,
      body: JSON.stringify({
        updatedIST: "Error loading data",
        totalJobs: 0,
        jobs: [],
        error: err.message,
      }),
    };
  }
};
