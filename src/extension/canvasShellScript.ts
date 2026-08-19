export const CANVAS_SHELL_SCRIPT = /* js */ `
(function () {
  var api = acquireVsCodeApi();
  var root = document.documentElement;
  var generation = Number(root.dataset.generation);
  var revision = Number(root.dataset.revision);
  var frame = document.getElementById('dvx-canvas-frame');
  var source = readJson('dvx-canvas-source');
  var baseline = readJson('dvx-canvas-baseline');
  var saved = api.getState() || {};
  var state = {
    view: valid(saved.view, ['preview', 'code', 'diff']) ? saved.view : 'preview',
    viewport: valid(saved.viewport, ['desktop', 'tablet', 'mobile'])
      ? saved.viewport : 'desktop',
    selecting: false,
    selection: null
  };

  function readJson(id) {
    var node = document.getElementById(id);
    if (!node) return '';
    try { return JSON.parse(node.textContent || '""'); } catch (_) { return ''; }
  }
  function valid(value, choices) { return choices.indexOf(value) !== -1; }
  function persist() {
    api.setState({ view: state.view, viewport: state.viewport });
  }
  function matches(message, keys) {
    if (!message || Object.getPrototypeOf(message) !== Object.prototype) return false;
    var own = Object.keys(message).sort();
    return own.length === keys.length &&
      own.every(function (key, index) { return key === keys.slice().sort()[index]; });
  }
  function bounded(value, maximum, required) {
    return value === undefined
      ? !required
      : typeof value === 'string' && value.length > 0 &&
        value.length <= maximum && !/[\\u0000-\\u001f\\u007f]/.test(value);
  }
  function selectionOf(value) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) return null;
    var allowed = ['tag', 'id', 'classes', 'text', 'path'];
    if (Object.keys(value).some(function (key) { return allowed.indexOf(key) === -1; }) ||
      !bounded(value.tag, 40, true) || !bounded(value.path, 480, true) ||
      !bounded(value.id, 120, false) || !bounded(value.classes, 200, false) ||
      !bounded(value.text, 240, false)) return null;
    return {
      tag: value.tag,
      path: value.path,
      id: value.id,
      classes: value.classes,
      text: value.text
    };
  }
  function command(type) {
    api.postMessage({ type: type, generation: generation, revision: revision });
  }
  function applyView(view) {
    state.view = view;
    document.querySelectorAll('[data-canvas-view]').forEach(function (node) {
      var active = node.dataset.canvasView === view;
      node.hidden = !active;
    });
    document.querySelectorAll('[data-view]').forEach(function (button) {
      var active = button.dataset.view === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    persist();
  }
  function applyViewport(viewport) {
    state.viewport = viewport;
    var stage = document.getElementById('dvx-canvas-preview');
    if (stage) stage.dataset.viewport = viewport;
    document.querySelectorAll('[data-viewport]').forEach(function (button) {
      var active = button.dataset.viewport === viewport;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    persist();
  }
  function applySelecting(enabled) {
    state.selecting = enabled;
    if (!enabled) state.selection = null;
    var button = document.getElementById('dvx-canvas-select');
    var summary = document.getElementById('dvx-canvas-selection');
    if (button) {
      button.classList.toggle('is-active', enabled);
      button.setAttribute('aria-pressed', String(enabled));
      button.textContent = enabled ? 'Selecting…' : 'Select element';
    }
    if (summary && !enabled) summary.textContent = 'No element selected';
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({
        type: 'dvx.canvas.selection',
        enabled: enabled,
        generation: generation,
        revision: revision
      }, '*');
    }
  }
  function renderCode() {
    var code = document.getElementById('dvx-canvas-code-content');
    if (code) code.textContent = source;
  }
  function renderDiff() {
    var output = document.getElementById('dvx-canvas-diff-content');
    if (!output) return;
    output.textContent = '';
    var beforeAll = baseline.split('\\n');
    var afterAll = source.split('\\n');
    var truncated = beforeAll.length > 2000 || afterAll.length > 2000;
    var before = beforeAll.slice(0, 2000);
    var after = afterAll.slice(0, 2000);
    var prefix = 0;
    while (prefix < before.length && prefix < after.length &&
      before[prefix] === after[prefix]) prefix += 1;
    var suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) {
      suffix += 1;
    }
    addRows(output, before.slice(0, prefix), 'same', ' ');
    addRows(output, before.slice(prefix, before.length - suffix), 'removed', '−');
    addRows(output, after.slice(prefix, after.length - suffix), 'added', '+');
    if (suffix > 0) addRows(output, after.slice(after.length - suffix), 'same', ' ');
    if (before.join('\\n') === after.join('\\n')) {
      output.textContent = '';
      var empty = document.createElement('p');
      empty.className = 'dvx-canvas-empty';
      empty.textContent = 'No changes from the opening baseline.';
      output.appendChild(empty);
    }
    if (truncated) {
      var limit = document.createElement('p');
      limit.className = 'dvx-canvas-empty';
      limit.textContent = 'Diff display is limited to the first 2,000 lines.';
      output.appendChild(limit);
    }
  }
  function addRows(output, lines, kind, marker) {
    lines.forEach(function (line) {
      var row = document.createElement('div');
      row.className = 'dvx-canvas-diff-line is-' + kind;
      var sign = document.createElement('span');
      sign.textContent = marker;
      var text = document.createElement('span');
      text.textContent = line || ' ';
      row.appendChild(sign);
      row.appendChild(text);
      output.appendChild(row);
    });
  }
  function describe(selection) {
    var label = '<' + selection.tag + '>';
    if (selection.id) label += ' #' + selection.id;
    if (selection.text) label += ' · ' + selection.text;
    return label;
  }

  document.querySelectorAll('[data-view]').forEach(function (button) {
    button.addEventListener('click', function () { applyView(button.dataset.view); });
  });
  document.querySelectorAll('[data-viewport]').forEach(function (button) {
    button.addEventListener('click', function () {
      applyViewport(button.dataset.viewport);
    });
  });
  document.getElementById('dvx-canvas-reload').addEventListener('click', function () {
    command('canvas.reload');
  });
  var open = document.getElementById('dvx-canvas-open');
  if (open) open.addEventListener('click', function () {
    command('canvas.openInEditor');
  });
  document.getElementById('dvx-canvas-select').addEventListener('click', function () {
    applySelecting(!state.selecting);
  });
  document.getElementById('dvx-canvas-feedback-open').addEventListener('click', function () {
    document.getElementById('dvx-canvas-feedback').hidden = false;
    document.getElementById('dvx-canvas-feedback-text').focus();
  });
  document.getElementById('dvx-canvas-feedback-close').addEventListener('click', function () {
    document.getElementById('dvx-canvas-feedback').hidden = true;
  });
  document.getElementById('dvx-canvas-feedback-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = document.getElementById('dvx-canvas-feedback-text');
    var feedback = input.value.trim();
    if (!feedback && state.selection) feedback = 'Please revise the selected element.';
    if (!feedback || feedback.length > 4000) return;
    var message = {
      type: 'canvas.feedback',
      generation: generation,
      revision: revision,
      feedback: feedback
    };
    if (state.selection) message.selection = state.selection;
    api.postMessage(message);
    input.value = '';
    document.getElementById('dvx-canvas-feedback').hidden = true;
  });
  window.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow) return;
    var message = event.data;
    if (!matches(message, ['type', 'generation', 'revision', 'selection']) ||
      message.type !== 'dvx.canvas.selected' ||
      message.generation !== generation || message.revision !== revision) return;
    var selection = selectionOf(message.selection);
    if (!selection) return;
    state.selection = selection;
    var summary = document.getElementById('dvx-canvas-selection');
    if (summary) summary.textContent = describe(selection);
  });
  if (frame) frame.addEventListener('load', function () {
    if (state.selecting) applySelecting(true);
  });
  renderCode();
  renderDiff();
  applyView(state.view);
  applyViewport(state.viewport);
})();
`;
