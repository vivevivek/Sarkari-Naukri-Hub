/**
 * fetch-jobs.js
 * Netlify Scheduled Function — runs every 60 minutes automatically
 * Fetches live job data from all 38 official government websites
 * Saves results to Netlify Blobs for the frontend to read
 */

import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";

// ─────────────────────────────────────────────
// ALL 38 SOURCES FROM EXCEL — grouped into 8 parallel batches
// ─────────────────────────────────────────────
const BATCHES = [
  {
    id: "ssc_railway",
    name: "SSC & Railway",
    query:
      "latest SSC CGL CHSL MTS GD CPO recruitment notification 2025 site:ssc.gov.in OR site:rrbcdg.gov.in vacancies apply online",
    sources: ["ssc.gov.in", "rrbcdg.gov.in"],
  },
  {
    id: "banking",
    name: "Banking — IBPS SBI RBI",
    query:
      "latest IBPS PO Clerk SO SBI PO Clerk RBI Grade B Assistant Manager recruitment 2025 notification vacancies ibps.in sbi.co.in opportunities.rbi.org.in",
    sources: ["ibps.in", "sbi.co.in/web/careers", "opportunities.rbi.org.in"],
  },
  {
    id: "upsc_employment",
    name: "UPSC & Employment News",
    query:
      "latest UPSC Civil Services IAS IPS NDA CDS CAPF ESE notification 2025 upsc.gov.in employmentnews.gov.in ncs.gov.in vacancies",
    sources: [
      "upsc.gov.in",
      "employmentnews.gov.in",
      "employmentnews.gov.in/rozgar-samachar",
      "ncs.gov.in",
    ],
  },
  {
    id: "defence",
    name: "Defence — Army Navy Air Force DRDO ISRO",
    query:
      "latest Indian Army Navy Air Force DRDO ISRO Agnipath recruitment 2025 notification vacancies joinindianarmy.nic.in joinindiannavy.gov.in agnipathvayu.cdac.in drdo.gov.in isro.gov.in",
    sources: [
      "joinindianarmy.nic.in",
      "joinindiannavy.gov.in",
      "agnipathvayu.cdac.in",
      "drdo.gov.in/careers",
      "isro.gov.in/Careers.html",
    ],
  },
  {
    id: "psu",
    name: "PSU — BHEL BEL",
    query:
      "latest BHEL BEL PSU recruitment 2025 notification vacancies engineer apprentice careers.bhel.in bel-india.in",
    sources: ["careers.bhel.in", "bel-india.in"],
  },
  {
    id: "odisha",
    name: "Odisha State Govt",
    query:
      "latest Odisha government job recruitment 2025 OPSC OSSC OSSSC Odisha Police vacancy notification opsc.gov.in ossc.gov.in osssc.gov.in odishapolice.gov.in empmissionodisha.gov.in",
    sources: [
      "opsc.gov.in",
      "ossc.gov.in",
      "osssc.gov.in",
      "odishapolice.gov.in",
      "empmissionodisha.gov.in",
    ],
  },
  {
    id: "state_psc_north",
    name: "State PSC — North & East India",
    query:
      "latest UPPSC BPSC MPPSC RPSC JPSC WBPSC CGPSC PPSC HPSC state PSC recruitment 2025 notification vacancies uppsc.up.nic.in bpsc.bih.nic.in mppsc.mp.gov.in rpsc.rajasthan.gov.in",
    sources: [
      "uppsc.up.nic.in",
      "bpsc.bih.nic.in",
      "mppsc.mp.gov.in",
      "rpsc.rajasthan.gov.in",
      "ppsc.gov.in",
      "hpsc.gov.in",
      "jpsc.gov.in",
      "psc.cg.gov.in",
      "psc.wb.gov.in",
    ],
  },
  {
    id: "state_psc_south_aggregators",
    name: "State PSC South + Aggregators",
    query:
      "latest MPSC TNPSC KPSC Maharashtra Tamil Nadu Karnataka PSC recruitment 2025 notification vacancies mpsc.gov.in tnpsc.gov.in kpsc.kar.nic.in sarkariresult.com freejobalert.com jagranjosh.com adda247.com testbook.com",
    sources: [
      "mpsc.gov.in",
      "tnpsc.gov.in",
      "kpsc.kar.nic.in",
      "sarkariresult.com",
      "freejobalert.com",
      "jagranjosh.com/jobs",
      "adda247.com/jobs",
      "testbook.com",
    ],
  },
];

const SYSTEM = `You are a government job data extractor for India's SarkariNaukriHub.in portal.

Search the specified websites and extract ALL current job notifications you find.

IMPORTANT: Return ONLY a raw JSON array. No markdown fences. No explanation. No preamble. Just the JSON array starting with [ and ending with ].

Each object in the array must have exactly these fields:
{
  "title": "Job title in English",
  "titleHindi": "Job title in Hindi",
  "org": "Full organization name",
  "category": "SSC|Railway|Bank|UPSC|State PSC|Defence|Central Govt|Result|Admit Card",
  "vacancies": "Number as string or Check notification",
  "lastDate": "DD Month YYYY or Check notification",
  "salary": "Salary range or As per 7th CPC",
  "eligibility": "Minimum qualification",
  "applyUrl": "https://official-site/apply-link",
  "sourceUrl": "https://exact-page-where-found",
  "sourceSite": "domain.gov.in",
  "urgency": "urgent|new|upcoming",
  "hindi_caption": "150-word Facebook post in Hindi with all details ending with #SarkariNaukri #GovtJobs2025 #SarkariNaukriHub"
}

Rules:
- Only include notifications from last 60 days
- Write exactly Check official notification for unknown fields
- Do not invent data`;

async function fetchBatch(client, batch) {
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Search these government job websites and extract current notifications:\n\nSources: ${batch.sources.join(", ")}\n\nSearch query: ${batch.query}\n\nDate today: ${new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}\n\nReturn a JSON array of 3-5 most recent notifications only.`,
        },
      ],
    });

    let text = "";
    for (const block of msg.content) {
      if (block.type === "text") text += block.text;
    }

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const jobs = JSON.parse(match[0]);
    if (!Array.isArray(jobs)) return [];

    return jobs.map((j) => ({
      ...j,
      _batch: batch.name,
      _fetchedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.error(`[${batch.id}] Error:`, err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// MAIN HANDLER — Netlify calls this every 60 min
// ─────────────────────────────────────────────
export const handler = async () => {
  console.log("SNH fetch started at", new Date().toISOString());

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set");
    return { statusCode: 500, body: "Missing API key" };
  }

  const client = new Anthropic({ apiKey });

  // Run all 8 batches in parallel
  const results = await Promise.allSettled(
    BATCHES.map((b) => fetchBatch(client, b))
  );

  let jobs = [];
  let hitCount = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length > 0) {
      jobs = jobs.concat(r.value);
      hitCount++;
      console.log(`[${BATCHES[i].id}] ${r.value.length} jobs`);
    } else {
      console.log(`[${BATCHES[i].id}] no results`);
    }
  });

  // Deduplicate by title
  const seen = new Set();
  jobs = jobs.filter((j) => {
    const k = (j.title || "").toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort urgent first
  const order = { urgent: 0, new: 1, upcoming: 2 };
  jobs.sort((a, b) => (order[a.urgency] || 1) - (order[b.urgency] || 1));

  const payload = {
    updatedIST: new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }),
    updatedUTC: new Date().toISOString(),
    totalJobs: jobs.length,
    sourcesHit: hitCount,
    totalSources: 38,
    jobs,
  };

  // Save to Netlify Blobs
  try {
    const store = getStore({
      name: "snh-jobs",
      consistency: "strong",
    });
    await store.setJSON("latest", payload);
    console.log(`Saved ${jobs.length} jobs to Netlify Blobs`);
  } catch (err) {
    console.error("Blob save error:", err.message);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      jobs: jobs.length,
      sources: hitCount,
      time: payload.updatedIST,
    }),
  };
};

// Schedule every 60 minutes
export const config = {
  schedule: "0 * * * *",
};
