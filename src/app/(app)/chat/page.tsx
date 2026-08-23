import type { Metadata } from "next";

import { ChatView } from "@/components/chat/chat-view";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Ask" };
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requireUser();
  const messages = await prisma.chatMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    take: 60,
    select: { id: true, role: true, content: true, model: true },
  });

  return (
    <div>
      <PageHeader
        title="Ask"
        description="Questions about your own performance. The backend sends only a compact summary of the current period — never the whole database — so each answer costs a fraction of a cent."
      />
      <PageBody>
        <ChatView initialMessages={messages} />
      </PageBody>
    </div>
  );
}
