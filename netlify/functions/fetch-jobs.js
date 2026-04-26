/**
 * fetch-jobs.js
 * Netlify Background Function — no timeout limit
 * Triggered by visiting /.netlify/functions/fetch-jobs
 * Runs in background, saves to Netlify Blobs
 * Also runs automatically every 60 min via schedule
 */

import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";

const SYSTEM = `You are a government job data extractor for India's SarkariNaukriHub.in.
Return ONLY a raw JSON array starting with [ and ending with ]. No markdown. No code fences.
Each object must have: title, titleHindi, org, category (SSC|Railway|Bank|UPSC|State PSC|Defence|Central Govt|Result|Admit Card), vacancies, lastDate, salary, eligibility, applyUrl, sourceUrl, sourceSite, urgency (urgent|new|upcoming), hindi_caption (150 word Hindi Facebook post ending with #SarkariNaukri #GovtJobs2025 #SarkariNaukriHub).
Return 6 real current notifications only. Write Check official notification for unknown fields.`;

const doFetch = async () => {
  console.log("SNH fetch started", new Date().toISOString());

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set");
    return;
  }
  console.log("API key OK:", apiKey.substring(0, 12));

  const client = new Anthropic({ apiKey });
  let newJobs = [];

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Find the 6 most recent Indian government job notifications from: ssc.gov.in, ibps.in, upsc.gov.in, opsc.gov.in, rrbcdg.gov.in, sarkariresult.com. Return JSON array only.`,
      }],
    });

    let text = "";
    for (const block of msg.content) {
      if (block.type === "text") text += block.text;
    }
    console.log("Response length:", text.length);

    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        newJobs = parsed.map(j => ({ ...j, _fetchedAt: new Date().toISOString() }));
        console.log("New jobs:", newJobs.length);
      }
    } else {
      console.log("No JSON array found in response");
    }
  } catch (err) {
    console.error("API call failed:", err.message);
    return;
  }

  // Load existing and merge
  let existingJobs = [];
  try {
    const store = getStore("snh-jobs");
    const existing = await store.get("latest", { type: "json" });
    if (existing?.jobs) {
      existingJobs = existing.jobs;
      console.log("Existing jobs:", existingJobs.length);
    }
  } catch (err) {
    console.log("No existing jobs:", err.message);
  }

  // Deduplicate
  const seen = new Set();
  const allJobs = [...newJobs, ...existingJobs].filter(j => {
    const k = (j.title || "").toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 60);

  allJobs.sort((a, b) =>
    ({ urgent: 0, new: 1, upcoming: 2 }[a.urgency] || 1) -
    ({ urgent: 0, new: 1, upcoming: 2 }[b.urgency] || 1)
  );

  const payload = {
    updatedIST: new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }),
    updatedUTC: new Date().toISOString(),
    totalJobs: allJobs.length,
    newThisFetch: newJobs.length,
    totalSources: 38,
    jobs: allJobs,
  };

  try {
    const store = getStore("snh-jobs");
    await store.setJSON("latest", payload);
    console.log("Saved to Netlify Blobs:", allJobs.length, "jobs");
  } catch (err) {
    console.error("Blob save failed:", err.message);
  }
};

// Background function handler — returns 202 immediately, runs in background
export const handler = async (event) => {
  // Start fetch in background (don't await)
  doFetch().catch(err => console.error("Background fetch error:", err));

  return {
    statusCode: 202,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      message: "Fetch started in background. Check /.netlify/functions/get-jobs in 60 seconds.",
    }),
  };
};

export const config = { schedule: "0 * * * *" };
