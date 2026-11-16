const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateShortenInput } = require('./validate-shorten-input');

function createHarness() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Expected inline <script> in index.html');

  function makeElement(id = '') {
    const listeners = {};
    const el = {
      type: '',
      name: '',
      value: '',
      checked: false,
      hidden: Boolean(id && new RegExp(`id="${id}"[^>]*\\bhidden\\b`).test(html)),
      children: [],
      validationMessage: '',
      validity: { valid: true },
      setCustomValidity(msg) {
        this.validationMessage = msg;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener(event, handler) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      },
      dispatchEvent(event) {
        const handlers = listeners[event.type] || [];
        for (const handler of handlers) {
          handler(event);
        }
      },
      querySelector(selector) {
        if (selector === 'input[name="short_url"]:checked') {
          for (const label of this.children) {
            for (const child of label.children) {
              if (child.type === 'radio' && child.name === 'short_url' && child.checked) {
                return child;
              }
            }
          }
        }
        return null;
      },
      reportValidity() {
        for (const input of [elements['url-input'], elements['custom-alias']]) {
          if (input.validationMessage || !input.validity.valid) {
            return false;
          }
        }
        return true;
      }
    };

    Object.defineProperty(el, 'textContent', {
      get() {
        return this._text || '';
      },
      set(val) {
        this._text = String(val);
        if (val === '') {
          this.children = [];
        }
      }
    });

    return el;
  }

  const ids = [
    'shorten-form',
    'url-input',
    'custom-alias',
    'suggestions-fieldset',
    'suggestions-list',
    'result-box',
    'result-short-url',
    'result-target-url'
  ];

  const elements = {};
  for (const id of ids) {
    elements[id] = makeElement(id);
  }

  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
    createElement() {
      return makeElement();
    }
  };

  vm.runInNewContext(scriptMatch[1], { document, validateShortenInput });

  function getRenderedChoices() {
    return elements['suggestions-list'].children.map((label) => ({
      value: label.children[0].value,
      checked: label.children[0].checked,
      text: label.children[1].textContent
    }));
  }

  return { elements, getRenderedChoices };
}

test('generates 5 deterministic short URL suggestions for a valid HTTP(S) URL', () => {
  const { elements, getRenderedChoices } = createHarness();
  const urlInput = elements['url-input'];
  const fieldset = elements['suggestions-fieldset'];

  assert.equal(fieldset.hidden, true);
  urlInput.value = 'https://www.example.com/blog/launch';
  urlInput.dispatchEvent({ type: 'input' });

  assert.equal(fieldset.hidden, false);
  const choices = getRenderedChoices();
  assert.equal(choices.length, 5);
  assert.equal(choices[0].value, '/s/example-launch');
  assert.equal(choices[0].text, '/s/example-launch');
  assert.equal(choices[0].checked, true);
  assert.equal(new Set(choices.map((c) => c.value)).size, 5);
});

test('rejects non-HTTP(S) schemes and hides suggestions', () => {
  const { elements, getRenderedChoices } = createHarness();
  const urlInput = elements['url-input'];
  const fieldset = elements['suggestions-fieldset'];

  urlInput.value = 'ftp://example.com/files';
  urlInput.dispatchEvent({ type: 'input' });

  assert.equal(fieldset.hidden, true);
  assert.equal(getRenderedChoices().length, 0);
  assert.equal(urlInput.validationMessage, 'Please enter an http:// or https:// URL.');
});

test('updates result box when user selects a suggestion or submits the form', () => {
  const { elements } = createHarness();
  const urlInput = elements['url-input'];
  const listEl = elements['suggestions-list'];
  const form = elements['shorten-form'];
  const resultBox = elements['result-box'];
  const resultShortUrl = elements['result-short-url'];
  const resultTargetUrl = elements['result-target-url'];

  urlInput.value = 'https://example.com/docs';
  urlInput.dispatchEvent({ type: 'input' });
  assert.equal(resultBox.hidden, true);

  listEl.children[0].children[0].checked = false;
  listEl.children[1].children[0].checked = true;
  listEl.dispatchEvent({ type: 'change' });

  assert.equal(resultBox.hidden, false);
  assert.equal(resultShortUrl.textContent, listEl.children[1].children[0].value);
  assert.equal(resultTargetUrl.textContent, 'https://example.com/docs');

  resultBox.hidden = true;
  form.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(resultBox.hidden, false);
});

test('includes normalized custom alias as the first of 5 suggestions when provided', () => {
  const { elements, getRenderedChoices } = createHarness();
  const urlInput = elements['url-input'];
  const aliasInput = elements['custom-alias'];

  urlInput.value = 'https://example.com/pricing';
  urlInput.dispatchEvent({ type: 'input' });
  const defaultValues = getRenderedChoices().map((c) => c.value);

  aliasInput.value = 'Promo 2026!';
  aliasInput.dispatchEvent({ type: 'input' });

  const choices = getRenderedChoices();
  assert.deepEqual(
    choices.map((c) => c.value),
    ['/s/promo-2026', ...defaultValues.slice(0, 4)]
  );
  assert.equal(choices[0].checked, true);
});

test('rejects custom alias that has no alphanumeric characters', () => {
  const { elements } = createHarness();
  const urlInput = elements['url-input'];
  const aliasInput = elements['custom-alias'];
  const fieldset = elements['suggestions-fieldset'];

  urlInput.value = 'https://example.com/pricing';
  aliasInput.value = '---';
  aliasInput.dispatchEvent({ type: 'input' });

  assert.equal(fieldset.hidden, true);
  assert.equal(aliasInput.validationMessage, 'Custom alias must contain letters or numbers.');
});

test('keeps all 5 suggestions distinct when custom alias matches default host-path slug', () => {
  const { elements, getRenderedChoices } = createHarness();
  const urlInput = elements['url-input'];
  const aliasInput = elements['custom-alias'];

  urlInput.value = 'https://site.com/link';
  urlInput.dispatchEvent({ type: 'input' });
  const defaultValues = getRenderedChoices().map((c) => c.value);

  aliasInput.value = 'site-link';
  aliasInput.dispatchEvent({ type: 'input' });

  const choices = getRenderedChoices();
  assert.deepEqual(
    choices.map((c) => c.value),
    defaultValues
  );
});

test('validateShortenInput accepts valid payload and matches UI suggestions', () => {
  const { elements, getRenderedChoices } = createHarness();
  elements['url-input'].value = 'https://example.com/blog/launch';
  elements['custom-alias'].value = 'Launch 26';
  elements['custom-alias'].dispatchEvent({ type: 'input' });

  const uiChoices = getRenderedChoices().map((c) => c.value);
  const result = validateShortenInput({
    url: 'https://example.com/blog/launch',
    custom_alias: 'Launch 26',
    short_url: uiChoices[1]
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    url: 'https://example.com/blog/launch',
    custom_alias: 'launch-26',
    short_url: uiChoices[1],
    suggestions: uiChoices
  });
});

test('validateShortenInput defaults short_url to first suggestion when omitted', () => {
  const result = validateShortenInput({
    url: 'https://example.com/docs'
  });

  assert.equal(result.valid, true);
  assert.equal(result.data.url, 'https://example.com/docs');
  assert.equal(result.data.custom_alias, '');
  assert.equal(result.data.short_url, '/s/example-docs');
  assert.equal(result.data.suggestions.length, 5);
});

test('validateShortenInput rejects invalid payloads, URLs, aliases, and unapproved short_url', () => {
  assert.deepEqual(validateShortenInput(null), {
    valid: false,
    field: 'body',
    error: 'Request payload must be an object.'
  });

  assert.deepEqual(validateShortenInput([]), {
    valid: false,
    field: 'body',
    error: 'Request payload must be an object.'
  });

  assert.deepEqual(validateShortenInput({ url: 'javascript:alert(1)' }), {
    valid: false,
    field: 'url',
    error: 'Please enter an http:// or https:// URL.'
  });

  assert.deepEqual(validateShortenInput({ url: 123 }), {
    valid: false,
    field: 'url',
    error: 'Please enter an http:// or https:// URL.'
  });

  assert.deepEqual(validateShortenInput({ url: 'https://example.com', custom_alias: 42 }), {
    valid: false,
    field: 'custom_alias',
    error: 'Custom alias must be a string.'
  });

  assert.deepEqual(validateShortenInput({ url: 'https://example.com', custom_alias: '!!!' }), {
    valid: false,
    field: 'custom_alias',
    error: 'Custom alias must contain letters or numbers.'
  });

  assert.deepEqual(
    validateShortenInput({ url: 'https://example.com', short_url: '/s/not-in-suggestions' }),
    {
      valid: false,
      field: 'short_url',
      error: 'Selected short URL must be one of the 5 suggested choices.'
    }
  );
});
