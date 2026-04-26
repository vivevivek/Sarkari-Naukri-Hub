/**
 * fetch-jobs.js — v4
 * Uses Netlify Functions v2 format with 60s timeout
 */

import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { schedule } from "@netlify/functions";

const SYSTEM = `You are a government job data extractor for India's SarkariNaukriHub.in.
Return ONLY a raw JSON array starting with [ and ending with ]. No markdown. No code fences.
Each object must have: title, titleHindi, org, category (SSC|Railway|Bank|UPSC|State PSC|Defence|Central Govt|Result|Admit Card), vacancies, lastDate, salary, eligibility, applyUrl, sourceUrl, sourceSite, urgency (urgent|new|upcoming), hindi_caption (150 word Hindi Facebook post ending with #SarkariNaukri #GovtJobs2025 #SarkariNaukriHub).
Return 5 real current notifications only. Write Check official notification for unknown fields.`;

const myHandler = async (event) => {
  console.log("fetch-jobs v4 started", new Date().toISOString());

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("No API key");
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "No API key" }) };
  }

  console.log("API key found:", apiKey.substring(0, 12));
  const client = new Anthropic({ apiKey });

  let newJobs = [];

  try {
    console.log("Calling Anthropic API...");
    const msg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Search for the 5 most recent Indian government job notifications from ssc.gov.in, ibps.in, upsc.gov.in, opsc.gov.in, sarkariresult.com. Return JSON array only.`,
      }],
    });

    console.log("API call complete, content blocks:", msg.content.length);

    let text = "";
    for (const block of msg.content) {
      if (block.type === "text") text += block.text;
    }

    console.log("Text length:", text.length);

    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        newJobs = parsed.map(j => ({ ...j, _fetchedAt: new Date().toISOString() }));
        console.log("Parsed jobs:", newJobs.length);
      }
    }
  } catch (err) {
    console.error("API error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }

  // Load and merge with existing
  let existingJobs = [];
  try {
    const store = getStore("snh-jobs");
    const existing = await store.get("latest", { type: "json" });
    if (existing?.jobs) existingJobs = existing.jobs;
    console.log("Existing jobs:", existingJobs.length);
  } catch (err) {
    console.log("No existing jobs:", err.message);
  }

  // Merge + deduplicate
  const seen = new Set();
  const allJobs = [...newJobs, ...existingJobs].filter(j => {
    const k = (j.title || "").toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 50);

  allJobs.sort((a, b) =>
    ({ urgent: 0, new: 1, upcoming: 2 }[a.urgency] || 1) -
    ({ urgent: 0, new: 1, upcoming: 2 }[b.urgency] || 1)
  );

  const payload = {
    updatedIST: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }),
    updatedUTC: new Date().toISOString(),
    totalJobs: allJobs.length,
    newThisFetch: newJobs.length,
    totalSources: 38,
    jobs: allJobs,
  };

  try {
    const store = getStore("snh-jobs");
    await store.setJSON("latest", payload);
    console.log("Saved to blobs:", allJobs.length);
  } catch (err) {
    console.error("Blob error:", err.message);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, jobs: allJobs.length, newThisFetch: newJobs.length, time: payload.updatedIST }),
  };
};

export const handler = schedule("0 * * * *", myHandler);
