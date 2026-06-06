import fs from "node:fs";
import path from "node:path";
import { ChatPanel } from "@/components/chat-panel";

const repoRoot = process.cwd();
const knowledgeIndexPath = path.join(repoRoot, "data", "knowledge-index.json");

export const dynamic = "force-dynamic";

export default function Home() {
  const hasIndex = fs.existsSync(knowledgeIndexPath);
  const voiceNumber = process.env.NEXT_PUBLIC_VOICE_PHONE_NUMBER;
  const calendarReady = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN,
  );

  const statusItems = [
    {
      label: "Chat index",
      ready: hasIndex,
      detail: hasIndex
        ? "Knowledge index is present."
        : "Add real sources and run npm run ingest.",
    },
    {
      label: "Voice number",
      ready: Boolean(voiceNumber),
      detail: voiceNumber || "Set NEXT_PUBLIC_VOICE_PHONE_NUMBER after provisioning a phone number.",
    },
    {
      label: "Calendar",
      ready: calendarReady,
      detail: calendarReady
        ? "Google Calendar OAuth is configured."
        : "Set Google OAuth credentials before booking real interviews.",
    },
  ];

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#f7f5ef] text-[#17130f]">
      <section className="shrink-0 border-b border-[#ded7ca] bg-[#fffcf6]">
        <div className="mx-auto max-w-7xl px-5 py-4 sm:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#6f5c42]">
              Scaler AI Engineer Intern Submission
            </p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight text-[#17130f] sm:text-3xl">
              Voice scheduling and grounded RAG chat for candidate screening.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#554b3f]">
              Ask grounded questions about Ayush&apos;s background, projects, GitHub work, and
              availability. The same calendar flow can schedule a real interview without manual
              follow-up.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-5 overflow-hidden px-5 py-5 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div id="chat" className="min-h-0 border border-[#ded7ca] bg-white shadow-sm">
          <ChatPanel hasIndex={hasIndex} />
        </div>

        <aside className="hidden h-full space-y-4 overflow-hidden lg:block">
          <div className="border border-[#ded7ca] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Submission readiness</h2>
            <div className="mt-4 space-y-3">
              {statusItems.map((item) => (
                <div key={item.label} className="border-t border-[#ece5d9] pt-4 first:border-t-0 first:pt-0">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-[#554b3f]">{item.label}</span>
                    <span
                      className={
                        item.ready
                          ? "bg-[#e4f4dd] px-2 py-1 text-xs font-semibold text-[#24551d]"
                          : "bg-[#fff2c7] px-2 py-1 text-xs font-semibold text-[#76520c]"
                      }
                    >
                      {item.ready ? "Ready" : "Blocked"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-5 text-[#6f665b]">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-[#ded7ca] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Voice agent flow</h2>
            <ol className="mt-3 space-y-2 text-sm leading-5 text-[#554b3f]">
              <li>1. Caller reaches the provisioned PSTN number.</li>
              <li>2. Voice platform posts tool calls to /api/voice/vapi.</li>
              <li>3. The app checks Google Calendar free/busy slots.</li>
              <li>4. A confirmed slot creates a real interview event.</li>
            </ol>
          </div>

          <div className="border border-[#ded7ca] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Grounding contract</h2>
            <p className="mt-2 text-sm leading-5 text-[#554b3f]">
              The chat endpoint retrieves source chunks before answering. If no chunk clears the
              similarity threshold, it returns an explicit unknown answer with no invented claims.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
