function readIndexHtml() {
  if (typeof require === 'function') {
    var fs = require('node:fs');
    var path = require('node:path');
    return fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  }
  ObjC.import('Foundation');
  var cwd = $.NSFileManager.defaultManager.currentDirectoryPath.js;
  var str = $.NSString.stringWithContentsOfFileEncodingError(
    cwd + '/index.html',
    $.NSUTF8StringEncoding,
    null
  );
  return str.js;
}

function parseUrlPolyfill(raw) {
  var match = String(raw).match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/);
  if (!match) {
    throw new TypeError('Invalid URL');
  }
  var protocol = match[1].toLowerCase();
  var hostname = match[2].toLowerCase();
  var pathname = match[3] || '/';
  var search = match[4] || '';
  var hash = match[5] || '';
  return {
    protocol: protocol,
    hostname: hostname,
    pathname: pathname,
    href: protocol + '//' + hostname + pathname + search + hash
  };
}

var URLCtor = typeof URL === 'function' ? URL : parseUrlPolyfill;

function assertEqual(actual, expected) {
  if (actual !== expected) {
    throw new Error('Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function createHarness() {
  var html = readIndexHtml();
  var scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) {
    throw new Error('Expected inline <script> in index.html');
  }

  function makeElement(id) {
    var listeners = {};
    var el = {
      type: '',
      name: '',
      value: '',
      checked: false,
      hidden: Boolean(id && new RegExp('id="' + id + '"[^>]*\\bhidden\\b').test(html)),
      children: [],
      validationMessage: '',
      validity: { valid: true },
      setCustomValidity: function (msg) {
        this.validationMessage = msg;
      },
      appendChild: function (child) {
        this.children.push(child);
        return child;
      },
      addEventListener: function (event, handler) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      },
      dispatchEvent: function (event) {
        var handlers = listeners[event.type] || [];
        for (var i = 0; i < handlers.length; i++) {
          handlers[i](event);
        }
      },
      querySelector: function (selector) {
        if (selector === 'input[name="short_url"]:checked') {
          for (var i = 0; i < this.children.length; i++) {
            var label = this.children[i];
            for (var j = 0; j < label.children.length; j++) {
              var child = label.children[j];
              if (child.type === 'radio' && child.name === 'short_url' && child.checked) {
                return child;
              }
            }
          }
        }
        return null;
      },
      reportValidity: function () {
        var inputs = [elements['url-input'], elements['custom-alias']];
        for (var i = 0; i < inputs.length; i++) {
          var input = inputs[i];
          if (input.validationMessage || !input.validity.valid) {
            return false;
          }
        }
        return true;
      }
    };

    Object.defineProperty(el, 'textContent', {
      get: function () {
        return this._text || '';
      },
      set: function (val) {
        this._text = String(val);
        if (val === '') {
          this.children = [];
        }
      }
    });

    return el;
  }

  var ids = [
    'shorten-form',
    'url-input',
    'custom-alias',
    'suggestions-fieldset',
    'suggestions-list',
    'result-box',
    'result-short-url',
    'result-target-url'
  ];

  var elements = {};
  for (var i = 0; i < ids.length; i++) {
    elements[ids[i]] = makeElement(ids[i]);
  }

  var mockDocument = {
    getElementById: function (id) {
      return elements[id] || null;
    },
    createElement: function () {
      return makeElement('');
    }
  };

  var runner = new Function('document', 'URL', scriptMatch[1]);
  runner(mockDocument, URLCtor);

  function getRenderedChoices() {
    var list = elements['suggestions-list'];
    return list.children.map(function (label) {
      var radio = label.children[0];
      var span = label.children[1];
      return {
        value: radio.value,
        checked: radio.checked,
        text: span.textContent
      };
    });
  }

  return { elements: elements, getRenderedChoices: getRenderedChoices };
}

var suite = [
  {
    name: 'generates 5 deterministic short URL suggestions for a valid HTTP(S) URL',
    fn: function () {
      var h = createHarness();
      var urlInput = h.elements['url-input'];
      var fieldset = h.elements['suggestions-fieldset'];

      assertEqual(fieldset.hidden, true);
      urlInput.value = 'https://www.example.com/blog/launch';
      urlInput.dispatchEvent({ type: 'input' });

      assertEqual(fieldset.hidden, false);
      var choices = h.getRenderedChoices();
      assertEqual(choices.length, 5);
      assertEqual(choices[0].value, '/s/example-launch');
      assertEqual(choices[0].text, '/s/example-launch');
      assertEqual(choices[0].checked, true);
      var uniqueCount = new Set(choices.map(function (c) { return c.value; })).size;
      assertEqual(uniqueCount, 5);
    }
  },
  {
    name: 'rejects non-HTTP(S) schemes and hides suggestions',
    fn: function () {
      var h = createHarness();
      var urlInput = h.elements['url-input'];
      var fieldset = h.elements['suggestions-fieldset'];

      urlInput.value = 'ftp://example.com/files';
      urlInput.dispatchEvent({ type: 'input' });

      assertEqual(fieldset.hidden, true);
      assertEqual(h.getRenderedChoices().length, 0);
      assertEqual(urlInput.validationMessage, 'Please enter an http:// or https:// URL.');
    }
  },
  {
    name: 'updates result box when user selects a suggestion or submits the form',
    fn: function () {
      var h = createHarness();
      var urlInput = h.elements['url-input'];
      var listEl = h.elements['suggestions-list'];
      var form = h.elements['shorten-form'];
      var resultBox = h.elements['result-box'];
      var resultShortUrl = h.elements['result-short-url'];
      var resultTargetUrl = h.elements['result-target-url'];

      urlInput.value = 'https://example.com/docs';
      urlInput.dispatchEvent({ type: 'input' });
      assertEqual(resultBox.hidden, true);

      listEl.children[0].children[0].checked = false;
      listEl.children[1].children[0].checked = true;
      listEl.dispatchEvent({ type: 'change' });

      assertEqual(resultBox.hidden, false);
      assertEqual(resultShortUrl.textContent, listEl.children[1].children[0].value);
      assertEqual(resultTargetUrl.textContent, 'https://example.com/docs');

      resultBox.hidden = true;
      form.dispatchEvent({ type: 'submit', preventDefault: function () {} });
      assertEqual(resultBox.hidden, false);
    }
  },
  {
    name: 'includes normalized custom alias as the first of 5 suggestions when provided',
    fn: function () {
      var h = createHarness();
      var urlInput = h.elements['url-input'];
      var aliasInput = h.elements['custom-alias'];

      urlInput.value = 'https://example.com/pricing';
      aliasInput.value = 'Promo 2026!';
      aliasInput.dispatchEvent({ type: 'input' });

      var choices = h.getRenderedChoices();
      assertEqual(choices.length, 5);
      assertEqual(choices[0].value, '/s/promo-2026');
      assertEqual(choices[0].checked, true);
    }
  },
  {
    name: 'rejects custom alias that has no alphanumeric characters',
    fn: function () {
      var h = createHarness();
      var urlInput = h.elements['url-input'];
      var aliasInput = h.elements['custom-alias'];
      var fieldset = h.elements['suggestions-fieldset'];

      urlInput.value = 'https://example.com/pricing';
      aliasInput.value = '---';
      aliasInput.dispatchEvent({ type: 'input' });

      assertEqual(fieldset.hidden, true);
      assertEqual(aliasInput.validationMessage, 'Custom alias must contain letters or numbers.');
    }
  },
  {
    name: 'keeps all 5 suggestions distinct when custom alias matches default host-path slug',
    fn: function () {
      var h = createHarness();
      var urlInput = h.elements['url-input'];
      var aliasInput = h.elements['custom-alias'];

      urlInput.value = 'https://site.com/link';
      aliasInput.value = 'site-link';
      aliasInput.dispatchEvent({ type: 'input' });

      var choices = h.getRenderedChoices();
      assertEqual(choices.length, 5);
      assertEqual(choices[0].value, '/s/site-link');
      var uniqueCount = new Set(choices.map(function (c) { return c.value; })).size;
      assertEqual(uniqueCount, 5);
    }
  }
];

if (typeof require === 'function') {
  var nodeTest = require('node:test');
  suite.forEach(function (t) {
    nodeTest(t.name, t.fn);
  });
} else {
  var passed = 0;
  var results = [];
  for (var i = 0; i < suite.length; i++) {
    var item = suite[i];
    item.fn();
    passed++;
    results.push('PASS: ' + item.name);
  }
  results.join('\n') + '\n\n' + passed + '/' + suite.length + ' unit tests passed.';
}
