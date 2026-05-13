/**
 * <mma-toast-stack> — non-blocking toast notifications.
 *
 * Public API: `push({ kind, message, duration })` — kind is
 * 'network' | 'server' (red, 'error' palette) or 'validation' (amber,
 * 'warning' palette). Duration in ms, default 4000; pass 0 to disable
 * auto-dismiss.
 *
 * UX rules from the briefing:
 *   - position: fixed, bottom-right
 *   - flat (no radius, no shadow), left-border stripe in kind's accent
 *   - max 3 visible at once, FIFO evict if a fourth arrives
 *   - 150ms fade in/out
 *   - dismiss button + auto-timeout
 *
 * The component is parent-agnostic: it lives at <body> level (or any
 * level) and uses position:fixed against the viewport.
 */
const MAX_STACK = 3;
const DEFAULT_DURATION = 4000;
const FADE_MS = 150;

export class MMAToastStack extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._toasts = [];
  }

  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          bottom: 16px;
          right: 16px;
          z-index: 1000000;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
        }

        .toast {
          min-width: 240px;
          max-width: 360px;
          padding: 10px 14px;
          font-size: 0.9rem;
          line-height: 1.4;
          border-left-width: 3px;
          border-left-style: solid;
          opacity: 0;
          transform: translateY(4px);
          transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
          pointer-events: auto;
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }

        .toast.visible {
          opacity: 1;
          transform: translateY(0);
        }

        .toast.error {
          background: #fef2f2;
          border-left-color: #dc2626;
          color: #7f1d1d;
        }

        .toast.warning {
          background: #fffbeb;
          border-left-color: #d97706;
          color: #78350f;
        }

        .toast-message {
          flex: 1;
          word-break: break-word;
        }

        .toast-dismiss {
          width: 20px;
          height: 20px;
          padding: 0;
          background: transparent;
          border: none;
          font-size: 1.1rem;
          line-height: 1;
          cursor: pointer;
          color: inherit;
          opacity: 0.6;
          flex-shrink: 0;
        }

        .toast-dismiss:hover {
          opacity: 1;
        }
      </style>
    `;
  }

  /**
   * @param {object} opts
   * @param {'network'|'server'|'validation'} [opts.kind]
   * @param {string} opts.message
   * @param {number} [opts.duration] - ms before auto-dismiss; 0 to disable.
   * @returns {object} entry handle (use _dismiss to close imperatively)
   */
  push({ kind = "server", message = "Unknown error", duration = DEFAULT_DURATION } = {}) {
    // FIFO evict if at the max.
    while (this._toasts.length >= MAX_STACK) {
      this._dismiss(this._toasts[0]);
    }

    const el = document.createElement("div");
    const palette = kind === "validation" ? "warning" : "error";
    el.className = `toast ${palette}`;

    const messageEl = document.createElement("span");
    messageEl.className = "toast-message";
    messageEl.textContent = message;

    const dismissEl = document.createElement("button");
    dismissEl.className = "toast-dismiss";
    dismissEl.title = "Dismiss";
    dismissEl.textContent = "×";

    el.appendChild(messageEl);
    el.appendChild(dismissEl);

    const entry = { el, timer: null };
    this._toasts.push(entry);
    this.shadowRoot.appendChild(el);

    // Trigger fade-in after attaching so the transition runs.
    requestAnimationFrame(() => el.classList.add("visible"));

    dismissEl.addEventListener("click", () => this._dismiss(entry));

    if (duration > 0) {
      entry.timer = setTimeout(() => this._dismiss(entry), duration);
    }
    return entry;
  }

  _dismiss(entry) {
    if (!entry || !this._toasts.includes(entry)) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.el.classList.remove("visible");
    setTimeout(() => {
      const i = this._toasts.indexOf(entry);
      if (i >= 0) this._toasts.splice(i, 1);
      entry.el.remove();
    }, FADE_MS);
  }
}

customElements.define("mma-toast-stack", MMAToastStack);
