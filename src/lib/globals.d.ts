export {};

declare global {
  interface Window {
    __HERMES_PLUGIN_SDK__: {
      sdkVersion: string;
      React: typeof import("react");
      hooks: Record<string, unknown>;
      api: Record<string, (...args: any[]) => Promise<any>>;
      fetchJSON: (url: string, init?: RequestInit) => Promise<any>;
      authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
      buildWsUrl: (path: string) => string;
      buildWsAuthParam: () => string;
      components: Record<string, any>;
      utils: { cn: (...args: any[]) => string; timeAgo: (ts: number) => string; isoTimeAgo: (iso: string) => string };
      useI18n: () => any;
    };
    __HERMES_PLUGINS__: {
      register: (name: string, component: any) => void;
      registerSlot: (name: string, slot: string, component: any) => void;
    };
  }
}
