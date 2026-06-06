import fs from "node:fs/promises";
import path from "node:path";

const lines = [
  "Scaler AI Intern Submission - 1 Page Evaluation Report",
  "",
  "Metrics",
  "Voice quality: Vapi web-call smoke test passed for persona Q&A and calendar-tool flow. Target first response <2s; final PSTN run should record p50/p95 first-response latency from Vapi logs, transcription errors from transcript review, and booking completion across 5 calls.",
  "Chat groundedness: local API smoke tests passed for resume Q&A, why-hire fit, live commit lookup, and prompt-injection refusal. The chat now uses an agentic tool loop over resume search, GitHub search, live GitHub metadata/commits, and calendar tools.",
  "Chat eval method: 15-question golden set split across resume, projects, GitHub, availability, booking, and adversarial prompts; manually label answer support and source relevance. Track hallucination rate, tool-selection accuracy, precision@5, recall@5, and p50/p95 response time.",
  "",
  "Failure Modes and Fixes",
  "1. Chat refused 'why should we hire you?' because local-hash retrieval scores were below the dense-embedding threshold. Fix: local-index threshold cap plus resume/GitHub fit retrieval boost.",
  "2. GitHub questions were weak because only resume was indexed. Fix: GitHub ingestion now adds README content, language stats, repo descriptions, topics, and recent commits before building the index.",
  "3. Scheduling and retrieval were separate branches, so mixed questions were brittle. Fix: /api/chat now lets the agent call calendar and retrieval tools in the same loop.",
  "",
  "Tradeoffs",
  "Accuracy vs coverage: the chat refuses unsupported claims and uses a small top-k for latency. This may miss obscure repo details, but it prevents confident hallucinations during probing.",
  "Cost vs reliability: Ollama Cloud is used for planning/generation and Gemini is used for embeddings. The local fallback preserves tool routing and extractive grounded answers during offline development or model outages.",
  "",
  "With 2 More Weeks",
  "Add an automated RAGAS/LLM-judge eval suite, transcript-level voice scoring, nightly GitHub re-indexing, uptime alerts for the 7-day review window, and a stricter slot-confirmation state machine for voice and chat.",
];

const pdf = buildPdf(lines);
const outputPath = path.join(process.cwd(), "public", "evaluation-report.pdf");
await fs.writeFile(outputPath, pdf);
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);

function buildPdf(sourceLines) {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginLeft = 42;
  const startY = 748;
  const leading = 12;
  const wrapped = sourceLines.flatMap((line) => wrap(line, line.startsWith("Scaler") ? 76 : 92));

  const content = [
    "BT",
    "/F1 10 Tf",
    `${marginLeft} ${startY} Td`,
    `${leading} TL`,
    ...wrapped.slice(0, 58).flatMap((line, index) => [
      index === 0 ? "/F1 12 Tf" : line && isHeading(line) ? "/F1 10 Tf" : "/F1 10 Tf",
      `(${escapePdf(line)}) Tj`,
      "T*",
    ]),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(body, "utf8");
}

function wrap(line, width) {
  if (!line) return [""];

  const words = line.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (`${current} ${word}`.trim().length <= width) {
      current = `${current} ${word}`.trim();
      continue;
    }
    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function isHeading(line) {
  return ["Metrics", "Failure Modes and Fixes", "Tradeoffs", "With 2 More Weeks"].includes(line);
}

function escapePdf(value) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
