/**
 * get-jobs.js — Final version
 * Uses SNH_SITE_ID and NETLIFY_BLOBS_TOKEN
 */

import { getStore } from "@netlify/blobs";

export const handler = async () => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  };

  const siteID = process.env.SNH_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  try {
    const store = getStore({ name: "snh-jobs", siteID, token });
    const data = await store.get("latest", { type: "json" });

    if (!data) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          updatedIST: "Not fetched yet — run fetch-jobs first",
          totalJobs: 0,
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
        updatedIST: "Error",
        totalJobs: 0,
        jobs: [],
        error: err.message,
      }),
    };
  }
};
