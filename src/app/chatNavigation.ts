// All conversation entry points use the canonical production route.
export function sidebarChatCommands(chain: string): string[] {
  return ['/chat', chain];
}

export function activeChatChain(url: string): string | null {
  const match = /^\/chat\/([^/?#]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}
