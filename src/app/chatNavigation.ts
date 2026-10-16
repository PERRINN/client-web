// Sidebar navigation keeps the Bubbles renderer only while that prototype is open.
export function sidebarChatCommands(url: string, chain: string): string[] {
  const bubbles = /^\/prototypes\/chat-bubbles(?:\/|[?#]|$)/.test(url);
  return [bubbles ? '/prototypes/chat-bubbles' : '/chat', chain];
}

export function activeChatChain(url: string): string | null {
  const match = /^\/(?:chat|prototypes\/chat-bubbles)\/([^/?#]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}
