export const CANVAS_SHELL_STYLE = /* css */ `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #efede8;
    color: #262626;
    font: 12.5px/1.45 ui-sans-serif, -apple-system, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, "Microsoft YaHei UI", sans-serif;
  }
  button, textarea { font: inherit; }
  button { color: inherit; }
  .dvx-canvas-bar {
    position: relative;
    z-index: 3;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    min-height: 52px;
    padding: 8px 14px;
    border-bottom: 1px solid rgb(0 0 0 / 9%);
    background: linear-gradient(180deg, #faf8f4, #f5f2ed);
    box-shadow: 0 1px 8px rgb(0 0 0 / 4%);
  }
  .dvx-canvas-identity { min-width: 120px; max-width: 34%; }
  .dvx-canvas-kicker {
    display: block;
    color: #a3664f;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .16em;
    text-transform: uppercase;
  }
  .dvx-canvas-title {
    display: block;
    overflow: hidden;
    color: #171717;
    font-weight: 620;
    letter-spacing: .005em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dvx-canvas-tabs, .dvx-canvas-viewports {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid rgb(0 0 0 / 7%);
    border-radius: 9px;
    background: rgb(255 255 255 / 55%);
  }
  .dvx-canvas-spacer { flex: 1; }
  .dvx-canvas-bar button, .dvx-canvas-feedback-actions button {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 7px;
    padding: 4px 9px;
    background: transparent;
    color: #737373;
    cursor: pointer;
    transition: color 130ms ease, background-color 130ms ease,
      border-color 130ms ease, transform 130ms ease;
  }
  .dvx-canvas-bar button:hover {
    color: #262626;
    background: rgb(255 255 255 / 76%);
  }
  .dvx-canvas-bar button.is-active {
    color: #262626;
    border-color: rgb(0 0 0 / 8%);
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 7%);
  }
  .dvx-canvas-bar button:active { transform: translateY(1px); }
  button:focus-visible, textarea:focus-visible {
    outline: 2px solid #d8673d;
    outline-offset: 2px;
  }
  .dvx-canvas-main {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  [data-canvas-view] { height: 100%; }
  [hidden] { display: none !important; }
  .dvx-canvas-preview {
    display: flex;
    justify-content: center;
    overflow: auto;
    padding: 18px;
    background:
      radial-gradient(circle at 50% -10%, rgb(255 255 255 / 70%), transparent 35%),
      #ebe8e2;
  }
  .dvx-canvas-frame-wrap {
    width: 100%;
    height: 100%;
    min-height: 360px;
    overflow: hidden;
    border: 1px solid rgb(0 0 0 / 10%);
    border-radius: 11px;
    background: #fff;
    box-shadow: 0 18px 50px -30px rgb(47 38 31 / 55%);
    transition: width 220ms cubic-bezier(.2,.8,.2,1);
  }
  [data-viewport="tablet"] .dvx-canvas-frame-wrap { width: min(768px, 100%); }
  [data-viewport="mobile"] .dvx-canvas-frame-wrap { width: min(390px, 100%); }
  .dvx-canvas-frame { width: 100%; height: 100%; border: 0; background: #fff; }
  .dvx-canvas-source-view {
    overflow: auto;
    padding: 22px clamp(18px, 4vw, 52px);
    background: #f5f3ef;
  }
  .dvx-canvas-source-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 18px;
    margin: 0 0 12px;
    color: #737373;
  }
  .dvx-canvas-source-head strong { color: #262626; font-size: 13px; }
  .dvx-canvas-code, .dvx-canvas-diff {
    margin: 0;
    min-width: min-content;
    padding: 18px 20px;
    border: 1px solid rgb(0 0 0 / 8%);
    border-radius: 11px;
    background: #fcfbf9;
    box-shadow: 0 14px 35px -30px rgb(0 0 0 / 45%);
    color: #3f3f46;
    font: 12px/1.65 "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    tab-size: 2;
    white-space: pre;
  }
  .dvx-canvas-diff-line {
    display: grid;
    grid-template-columns: 20px 1fr;
    min-height: 20px;
    padding: 0 8px;
  }
  .dvx-canvas-diff-line.is-added { background: #edf6ed; color: #2f6336; }
  .dvx-canvas-diff-line.is-removed { background: #fbefec; color: #8a493b; }
  .dvx-canvas-empty { margin: 34px auto; color: #8a8a8a; text-align: center; }
  .dvx-canvas-feedback {
    position: absolute;
    z-index: 5;
    right: 16px;
    bottom: 16px;
    width: min(390px, calc(100% - 32px));
    padding: 14px;
    border: 1px solid rgb(0 0 0 / 11%);
    border-radius: 13px;
    background: rgb(252 250 247 / 96%);
    box-shadow: 0 24px 60px -24px rgb(37 30 25 / 55%);
    backdrop-filter: blur(14px);
    animation: dvx-canvas-rise 170ms cubic-bezier(.2,.8,.2,1);
  }
  .dvx-canvas-feedback label {
    display: block;
    margin-bottom: 8px;
    font-weight: 620;
  }
  .dvx-canvas-selection {
    margin-bottom: 8px;
    overflow: hidden;
    color: #8a8a8a;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dvx-canvas-feedback textarea {
    width: 100%;
    height: 92px;
    resize: none;
    padding: 9px 10px;
    border: 1px solid #dedad3;
    border-radius: 9px;
    background: #fff;
    color: #262626;
  }
  .dvx-canvas-feedback-actions {
    display: flex;
    justify-content: flex-end;
    gap: 7px;
    margin-top: 9px;
  }
  .dvx-canvas-feedback-actions button { border-color: #ddd8d0; background: #fff; }
  .dvx-canvas-feedback-actions .is-primary {
    border-color: #c65f39;
    background: #d8673d;
    color: #fff;
  }
  .dvx-canvas-notice {
    margin: auto;
    max-width: 440px;
    padding: 18px 24px;
    border: 1px solid #dedad3;
    border-radius: 11px;
    background: #fff;
    color: #737373;
    text-align: center;
    box-shadow: 0 18px 45px -28px rgb(0 0 0 / 45%);
  }
  @keyframes dvx-canvas-rise {
    from { opacity: 0; transform: translateY(8px) scale(.985); }
  }
  @media (max-width: 620px) {
    .dvx-canvas-bar { gap: 6px; padding-inline: 9px; }
    .dvx-canvas-identity { max-width: 55%; }
    .dvx-canvas-preview { padding: 8px; }
    .dvx-canvas-viewports { order: 4; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
`;
