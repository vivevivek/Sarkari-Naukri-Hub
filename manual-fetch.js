/**
 * manual-fetch.js
 * POST /.netlify/functions/manual-fetch
 * Requires header: x-admin-key: <your ADMIN_KEY env var>
 * Use from admin panel to trigger an immediate fetch without waiting 60 min
 */

import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";

const BATCHES = [
  {
    id: "ssc_railway",
    name: "SSC & Railway",
    query:
      "latest SSC CGL CHSL MTS GD CPO Railway RRB recruitment notification 2025 vacancies ssc.gov.in rrbcdg.gov.in",
    sources: ["ssc.gov.in", "rrbcdg.gov.in"],
  },
  {
    id: "banking",
    name: "Banking",
    query:
      "latest IBPS PO Clerk SBI PO RBI Grade B recruitment 2025 notification vacancies ibps.in sbi.co.in",
    sources: ["ibps.in", "sbi.co.in", "opportunities.rbi.org.in"],
  },
  {
    id: "upsc",
    name: "UPSC",
    query:
      "latest UPSC Civil Services NDA CDS notification 2025 vacancies upsc.gov.in",
    sources: ["upsc.gov.in", "employmentnews.gov.in", "ncs.gov.in"],
  },
  {
    id: "defence",
    name: "Defence",
    query:
      "latest Army Navy Air Force DRDO ISRO recruitment 2025 vacancies notification",
    sources: [
      "joinindianarmy.nic.in",
      "joinindiannavy.gov.in",
      "drdo.gov.in",
      "isro.gov.in",
    ],
  },
  {
    id: "odisha",
    name: "Odisha",
    query:
      "latest OPSC OSSC OSSSC Odisha Police recruitment 2025 vacancies notification",
    sources: [
      "opsc.gov.in",
      "ossc.gov.in",
      "osssc.gov.in",
      "odishapolice.gov.in",
    ],
  },
  {
    id: "state_north",
    name: "State PSC North",
    query:
      "latest UPPSC BPSC MPPSC RPSC JPSC WBPSC state PSC recruitment 2025 notification",
    sources: [
      "uppsc.up.nic.in",
      "bpsc.bih.nic.in",
      "mppsc.mp.gov.in",
      "rpsc.rajasthan.gov.in",
    ],
  },
  {
    id: "state_south",
    name: "State PSC South",
    query:
      "latest MPSC TNPSC KPSC Maharashtra Tamil Nadu Karnataka PSC recruitment 2025",
    sources: ["mpsc.gov.in", "tnpsc.gov.in", "kpsc.kar.nic.in"],
  },
  {
    id: "aggregators",
    name: "Aggregators",
    query:
      "latest sarkari naukri government jobs 2025 notification result admit card sarkariresult.com freejobalert.com",
    sources: ["sarkariresult.com", "freejobalert.com", "testbook.com"],
  },
];

const SYSTEM = `You are a government job data extractor. Extract REAL current job notifications from the search results. Return ONLY a raw JSON array starting with [ and ending with ]. No markdown, no explanation. Each object: title, titleHindi, org, category (SSC|Railway|Bank|UPSC|State PSC|Defence|Central Govt|Result|Admit Card), vacancies, lastDate, salary, eligibility, applyUrl, sourceUrl, sourceSite, urgency (urgent|new|upcoming), hindi_caption (150-word Hindi FB post ending with #SarkariNaukri #GovtJobs2025 #SarkariNaukriHub). Write Check official notification for unknown fields.`;

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "x-admin-key, content-type",
  };

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers, body: "" };

  if (event.httpMethod !== "POST")
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "POST only" }),
    };

  const adminKey = event.headers["x-admin-key"];
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const results = await Promise.allSettled(
    BATCHES.map(async (batch) => {
      try {
        const msg = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          system: SYSTEM,
          messages: [
            {
              role: "user",
              content: `Sources: ${batch.sources.join(", ")}\nQuery: ${batch.query}\nDate: ${new Date().toLocaleDateString("en-IN")}\nReturn JSON array only.`,
            },
          ],
        });
        let text = "";
        for (const b of msg.content) if (b.type === "text") text += b.text;
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return [];
        const jobs = JSON.parse(match[0]);
        return Array.isArray(jobs)
          ? jobs.map((j) => ({
              ...j,
              _batch: batch.name,
              _fetchedAt: new Date().toISOString(),
            }))
          : [];
      } catch {
        return [];
      }
    })
  );

  let jobs = [];
  results.forEach((r) => {
    if (r.status === "fulfilled") jobs = jobs.concat(r.value);
  });

  const seen = new Set();
  jobs = jobs.filter((j) => {
    const k = (j.title || "").toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  jobs.sort(
    (a, b) =>
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
    totalJobs: jobs.length,
    sourcesHit: results.filter(
      (r) => r.status === "fulfilled" && r.value.length > 0
    ).length,
    totalSources: 38,
    jobs,
  };

  const store = getStore({ name: "snh-jobs", consistency: "strong" });
  await store.setJSON("latest", payload);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      jobs: jobs.length,
      time: payload.updatedIST,
    }),
  };
};
