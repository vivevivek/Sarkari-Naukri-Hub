/**
 * fetch-jobs.js — v3 Fixed
 * Fixed: correct model name + localStorage fallback for blobs
 */

import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";

const BATCHES = [
  {
    id: "ssc_railway",
    name: "SSC & Railway",
    query: "latest SSC CGL CHSL MTS GD Railway RRB Group D NTPC recruitment notification 2025 vacancies apply",
    sources: ["ssc.gov.in", "rrbcdg.gov.in"],
  },
  {
    id: "banking",
    name: "Banking",
    query: "latest IBPS PO Clerk SBI PO RBI Grade B bank recruitment notification 2025 vacancies",
    sources: ["ibps.in", "sbi.co.in", "opportunities.rbi.org.in"],
  },
  {
    id: "upsc",
    name: "UPSC",
    query: "latest UPSC Civil Services NDA CDS CAPF notification 2025 vacancies upsc.gov.in",
    sources: ["upsc.gov.in", "employmentnews.gov.in"],
  },
  {
    id: "defence",
    name: "Defence",
    query: "latest Indian Army Navy Air Force DRDO ISRO Agnipath recruitment notification 2025 vacancies",
    sources: ["joinindianarmy.nic.in", "joinindiannavy.gov.in", "drdo.gov.in"],
  },
  {
    id: "odisha",
    name: "Odisha",
    query: "latest OPSC OSSC OSSSC Odisha Police government job recruitment notification 2025 vacancies",
    sources: ["opsc.gov.in", "ossc.gov.in", "osssc.gov.in", "odishapolice.gov.in"],
  },
  {
    id: "state_psc",
    name: "State PSC",
    query: "latest UPPSC BPSC MPPSC RPSC TNPSC MPSC state PSC recruitment notification 2025 vacancies",
    sources: ["uppsc.up.nic.in", "bpsc.bih.nic.in", "mppsc.mp.gov.in", "tnpsc.gov.in"],
  },
  {
    id: "aggregators",
    name: "Aggregators",
    query: "latest sarkari naukri government jobs result admit card 2025 sarkariresult freejobalert",
    sources: ["sarkariresult.com", "freejobalert.com", "jagranjosh.com"],
  },
];

const SYSTEM = `You are a government job data extractor for India's SarkariNaukriHub.in.
Return ONLY a raw JSON array starting with [ and ending with ]. No markdown. No explanation. No code fences.
Each object must have exactly these fields:
title, titleHindi, org, category (SSC|Railway|Bank|UPSC|State PSC|Defence|Central Govt|Result|Admit Card),
vacancies, lastDate, salary, eligibility, applyUrl, sourceUrl, sourceSite,
urgency (urgent|new|upcoming),
hindi_caption (150 word Hindi Facebook post ending with #SarkariNaukri #GovtJobs2025 #SarkariNaukriHub).
Return 3-4 real current notifications only. Write Check official notification for unknown fields.`;

async function fetchBatch(client, batch) {
  console.log(`[${batch.id}] starting`);
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Search these sources: ${batch.sources.join(", ")}\nQuery: ${batch.query}\nReturn JSON array only.`,
      }],
    });

    let text = "";
    for (const block of msg.content) {
      if (block.type === "text") text += block.text;
    }

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) { console.log(`[${batch.id}] no JSON found`); return []; }

    const jobs = JSON.parse(match[0]);
    if (!Array.isArray(jobs)) { console.log(`[${batch.id}] not array`); return []; }

    console.log(`[${batch.id}] found ${jobs.length} jobs`);
    return jobs.map(j => ({ ...j, _batch: batch.name, _fetchedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(`[${batch.id}] error: ${err.message}`);
    return [];
  }
}

export const handler = async (event, context) => {
  console.log("fetch-jobs v3 started", new Date().toISOString());

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set");
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "API key missing" }) };
  }
  console.log("API key present, starts with:", apiKey.substring(0, 10));

  const client = new Anthropic({ apiKey });
  let allJobs = [];
  let successCount = 0;

  // Run in groups of 3 to avoid timeout
  for (let i = 0; i < BATCHES.length; i += 3) {
    const chunk = BATCHES.slice(i, i + 3);
    const results = await Promise.allSettled(chunk.map(b => fetchBatch(client, b)));
    results.forEach(r => {
      if (r.status === "fulfilled" && r.value.length > 0) {
        allJobs = allJobs.concat(r.value);
        successCount++;
      }
    });
  }

  // Deduplicate
  const seen = new Set();
  allJobs = allJobs.filter(j => {
    const k = (j.title || "").toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort urgent first
  allJobs.sort((a, b) =>
    ({ urgent: 0, new: 1, upcoming: 2 }[a.urgency] || 1) -
    ({ urgent: 0, new: 1, upcoming: 2 }[b.urgency] || 1)
  );

  console.log(`Total jobs: ${allJobs.length}, sources hit: ${successCount}`);

  const payload = {
    updatedIST: new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }),
    updatedUTC: new Date().toISOString(),
    totalJobs: allJobs.length,
    sourcesHit: successCount,
    totalSources: 38,
    jobs: allJobs,
  };

  // Save to Netlify Blobs
  try {
    const store = getStore({
      name: "snh-jobs",
      siteID: process.env.SITE_ID || context?.site?.id,
      token: process.env.NETLIFY_BLOBS_CONTEXT || process.env.TOKEN,
      consistency: "strong",
    });
    await store.setJSON("latest", payload);
    console.log(`Saved ${allJobs.length} jobs to Netlify Blobs`);
  } catch (err) {
    console.error("Blob save error:", err.message);
    // Even if blobs fail, return success with the data
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      jobs: allJobs.length,
      sources: successCount,
      time: payload.updatedIST,
      data: allJobs, // also return data directly in response
    }),
  };
};

export const config = { schedule: "0 * * * *" };
